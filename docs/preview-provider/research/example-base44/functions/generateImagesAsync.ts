import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { orderId } = await req.json();

        if (!orderId) {
            return Response.json({ error: 'Order ID is required' }, { status: 400 });
        }

        // Проверяем наличие auth token для async API
        const authToken = Deno.env.get("ASYNC_BYTEPLUS_AUTH_TOKEN");
        
        if (!authToken) {
            return Response.json({ error: 'Async API auth token not configured' }, { status: 500 });
        }

        // Создаём Basic Auth header (токен как username, пароль пустой)
        const authHeader = `Basic ${authToken}`;

        // Получаем заказ
        const orders = await base44.entities.Order.filter({ id: orderId });
        const order = orders[0];

        if (!order) {
            return Response.json({ error: 'Order not found' }, { status: 404 });
        }

        if (!order.photos || order.photos.length === 0) {
            return Response.json({ error: 'No photos uploaded' }, { status: 400 });
        }

        if (!order.template_package_id) {
            return Response.json({ error: 'No template package selected' }, { status: 400 });
        }

        // Получаем пакет шаблонов
        const packages = await base44.entities.TemplatePackage.filter({ id: order.template_package_id });
        const pkg = packages[0];

        if (!pkg || !pkg.templates || pkg.templates.length === 0) {
            return Response.json({ error: 'Template package not found or empty' }, { status: 404 });
        }

        // Функция замены переменных в промпте
        const replaceVariables = (prompt) => {
            return prompt
                .replace(/\[имя\]/g, order.baby_name || '')
                .replace(/\[вес\]/g, order.baby_weight ? `${order.baby_weight} kg` : '')
                .replace(/\[рост\]/g, order.baby_height ? `${order.baby_height} cm` : '')
                .replace(/\[дата\]/g, order.birth_date || '')
                .replace(/\[время\]/g, order.birth_time || '');
        };

        // Инициализируем массив изображений для сохранения
        const generatedImages = pkg.templates.map(template => ({
            id: crypto.randomUUID(),
            template_id: template.id,
            image_url: null,
            status: 'pending',
            async_task_id: null,
            progress: 0
        }));

        // Обновляем статус заказа на "processing"
        await base44.asServiceRole.entities.Order.update(orderId, {
            status: 'processing',
            progress: 0,
            generated_images: generatedImages
        });

        console.log('=== ЗАПУСК АСИНХРОННОЙ ГЕНЕРАЦИИ ===');
        console.log('Количество шаблонов:', pkg.templates.length);

        // Параллельный запуск генерации для всех шаблонов
        const generationPromises = pkg.templates.map(async (template, index) => {
            try {
                const finalPrompt = replaceVariables(template.prompt);
                
                const requestBody = {
                    model: 'seedream-4-5-251128',
                    prompt: finalPrompt,
                    image: order.photos,
                    size: '2K',
                    sequential_image_generation: 'disabled',
                    response_format: 'url',
                    stream: false,
                    watermark: false
                };

                console.log(`Запуск генерации для шаблона ${index + 1}:`, template.id);

                const response = await fetch('https://async-byteplus.aom-tech.ru/api/generate', {
                    method: 'POST',
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestBody)
                });

                const result = await response.json();

                console.log(`Ответ для шаблона ${index + 1}:`, result);

                if (!response.ok) {
                    return {
                        templateId: template.id,
                        imageIndex: index,
                        success: false,
                        error: result.message || 'Generation failed',
                        errorDetails: {
                            status_code: response.status,
                            status_text: response.statusText,
                            error_code: result.code || result.error_code || 'UNKNOWN',
                            error_message: result.message || result.error || 'Generation failed',
                            timestamp: new Date().toISOString()
                        }
                    };
                }

                return {
                    templateId: template.id,
                    imageIndex: index,
                    success: true,
                    taskId: result.task_id
                };

            } catch (error) {
                console.error(`Ошибка при генерации шаблона ${index + 1}:`, error);
                return {
                    templateId: template.id,
                    imageIndex: index,
                    success: false,
                    error: error.message,
                    errorDetails: {
                        status_code: 0,
                        status_text: 'Network Error',
                        error_code: 'NETWORK_ERROR',
                        error_message: error.message,
                        timestamp: new Date().toISOString()
                    }
                };
            }
        });

        // Ждём завершения всех запросов
        const results = await Promise.all(generationPromises);

        // Обновляем generated_images с task_id и статусами
        const updatedImages = generatedImages.map((img, index) => {
            const result = results[index];
            
            if (result.success) {
                return {
                    ...img,
                    async_task_id: result.taskId,
                    status: 'generating',
                    progress: 0
                };
            } else {
                return {
                    ...img,
                    status: 'failed',
                    error: result.error,
                    error_details: result.errorDetails
                };
            }
        });

        // Сохраняем task_id в БД для персистентности
        await base44.asServiceRole.entities.Order.update(orderId, {
            generated_images: updatedImages
        });

        const successCount = results.filter(r => r.success).length;
        const failedCount = results.filter(r => !r.success).length;

        console.log(`=== РЕЗУЛЬТАТ ЗАПУСКА ===`);
        console.log(`Успешно запущено: ${successCount}`);
        console.log(`Не удалось запустить: ${failedCount}`);

        return Response.json({ 
            success: true,
            started_count: successCount,
            failed_count: failedCount,
            total_count: pkg.templates.length
        });
    } catch (error) {
        console.error('Ошибка в generateImagesAsync:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});

