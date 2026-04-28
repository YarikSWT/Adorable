import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { orderId, templateId } = await req.json();

        if (!orderId) {
            return Response.json({ error: 'Order ID is required' }, { status: 400 });
        }

        if (!templateId) {
            return Response.json({ error: 'Template ID is required' }, { status: 400 });
        }

        const apiKey = Deno.env.get("SEEDDREAM_API_KEY");
        if (!apiKey) {
            return Response.json({ error: 'SeedDream API key not configured' }, { status: 500 });
        }

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

        // Находим нужный шаблон
        const template = pkg.templates.find(t => t.id === templateId);
        if (!template) {
            return Response.json({ error: 'Template not found in package' }, { status: 404 });
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

        // Генерируем изображение для указанного шаблона
        const finalPrompt = replaceVariables(template.prompt);
        
        const requestBody = {
            model: 'seedream-4-5-251128',
            prompt: finalPrompt,
            image: order.photos, // Передаем все фото
            size: '2048x2048',
            sequential_image_generation: 'disabled',
            response_format: 'url',
            watermark: false
        };

        console.log('=== ЗАПРОС К SEEDDREAM API ===');
        console.log('URL:', 'https://ark.ap-southeast.bytepluses.com/api/v3/images/generations');
        console.log('Template ID:', templateId);
        console.log('Промпт:', finalPrompt);
        console.log('Количество референсных фото:', order.photos.length);
        console.log('Первое фото (первые 100 символов):', order.photos[0]?.substring(0, 100));
        console.log('Полное тело запроса:', JSON.stringify(requestBody, null, 2));

        const response = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        console.log('=== ОТВЕТ ОТ SEEDDREAM API ===');
        console.log('Статус:', response.status, response.statusText);
        
        const result = await response.json();
        console.log('Тело ответа:', JSON.stringify(result, null, 2));

        if (!response.ok) {
            return Response.json({ 
                success: false,
                error: result.error?.message || 'Generation failed',
                template_id: templateId
            }, { status: response.status });
        }

        if (result.data && result.data.length > 0) {
            const generatedImageUrl = result.data[0].url;
            
            // Скачиваем и сохраняем изображение в хранилище Base44
            let savedImageUrl = generatedImageUrl;
            try {
                console.log('Загрузка изображения в хранилище...');
                const imageResponse = await fetch(generatedImageUrl);
                
                if (!imageResponse.ok) {
                    throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
                }
                
                // Получаем blob
                const imageBlob = await imageResponse.blob();
                
                // Проверяем, что blob не пустой
                if (!imageBlob || imageBlob.size === 0) {
                    throw new Error('Downloaded image blob is empty');
                }
                
                // Создаем File объект из blob (как в рабочем примере)
                const imageFile = new File([imageBlob], 'image.jpg', { type: 'image/jpeg' });
                
                // Загружаем в Base44 хранилище
                const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({
                    file: imageFile
                });
                
                savedImageUrl = uploadResult.file_url;
                console.log('✅ Изображение сохранено в base44:', savedImageUrl);
            } catch (uploadError) {
                console.error('Ошибка загрузки изображения в хранилище:', uploadError);
                // Продолжаем с оригинальным URL если загрузка не удалась
            }
            
            // Получаем текущий массив generated_images или создаем новый
            const currentImages = order.generated_images || [];
            const imageId = crypto.randomUUID();
            
            // Добавляем новое изображение
            const newImage = {
                id: imageId,
                template_id: templateId,
                image_url: savedImageUrl,
                status: 'generated',
                seed_dream_task_id: result.data[0].id || null
            };
            
            const updatedImages = [...currentImages, newImage];
            
            // Обновляем Order с новым изображением
            await base44.asServiceRole.entities.Order.update(orderId, {
                generated_images: updatedImages
            });
            
            return Response.json({ 
                success: true,
                image: newImage
            });
        }

        return Response.json({ 
            success: false,
            error: 'No image data in response',
            template_id: templateId
        }, { status: 500 });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});