import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { orderId, imageId } = await req.json();

        if (!orderId || !imageId) {
            return Response.json({ error: 'Order ID and Image ID are required' }, { status: 400 });
        }

        const authToken = Deno.env.get("ASYNC_BYTEPLUS_AUTH_TOKEN");
        
        if (!authToken) {
            return Response.json({ error: 'Async API auth token not configured' }, { status: 500 });
        }

        // Получаем заказ
        const orders = await base44.entities.Order.filter({ id: orderId });
        const order = orders[0];

        if (!order) {
            return Response.json({ error: 'Order not found' }, { status: 404 });
        }

        // Находим изображение для перегенерации
        const imageToRegenerate = order.generated_images?.find(img => img.id === imageId);
        if (!imageToRegenerate) {
            return Response.json({ error: 'Image not found' }, { status: 404 });
        }

        // Получаем пакет шаблонов и конкретный шаблон
        const packages = await base44.entities.TemplatePackage.filter({ id: order.template_package_id });
        const pkg = packages[0];
        const template = pkg?.templates?.find(t => t.id === imageToRegenerate.template_id);

        if (!template) {
            return Response.json({ error: 'Template not found' }, { status: 404 });
        }

        // Заменяем переменные в промпте
        const replaceVariables = (prompt) => {
            return prompt
                .replace(/\[имя\]/g, order.baby_name || '')
                .replace(/\[вес\]/g, order.baby_weight ? `${order.baby_weight} kg` : '')
                .replace(/\[рост\]/g, order.baby_height ? `${order.baby_height} cm` : '')
                .replace(/\[дата\]/g, order.birth_date || '')
                .replace(/\[время\]/g, order.birth_time || '');
        };

        const finalPrompt = replaceVariables(template.prompt);

        // Создаём Basic Auth header (токен как username, пароль пустой)
        const authHeader = `Basic ${authToken}`;

        // Генерируем новое изображение
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

        console.log('=== ЗАПУСК АСИНХРОННОЙ ПЕРЕГЕНЕРАЦИИ ===');
        console.log('Image ID:', imageId);
        console.log('Template ID:', template.id);

        const response = await fetch('https://async-byteplus.aom-tech.ru/api/generate', {
            method: 'POST',
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        console.log('Ответ от API:', result);

        if (!response.ok) {
            // Обновляем статус на failed
            const errorDetails = {
                status_code: response.status,
                status_text: response.statusText,
                error_code: result.code || result.error_code || 'UNKNOWN',
                error_message: result.message || result.error || 'Regeneration failed',
                timestamp: new Date().toISOString()
            };
            
            const updatedImages = order.generated_images.map(img =>
                img.id === imageId ? { 
                    ...img, 
                    status: 'failed',
                    error: result.message || 'Regeneration failed',
                    error_details: errorDetails
                } : img
            );
            await base44.asServiceRole.entities.Order.update(orderId, { generated_images: updatedImages });
            
            return Response.json({ error: result.message || 'Generation failed' }, { status: 500 });
        }

        // Обновляем изображение с task_id и статусом generating
        const updatedImages = order.generated_images.map(img =>
            img.id === imageId ? {
                ...img,
                async_task_id: result.task_id,
                status: 'generating',
                progress: 0,
                image_url: null
            } : img
        );
        
        await base44.asServiceRole.entities.Order.update(orderId, { generated_images: updatedImages });

        console.log('Задача создана. Task ID:', result.task_id);

        return Response.json({ 
            success: true,
            task_id: result.task_id,
            message: 'Regeneration started'
        });

    } catch (error) {
        console.error('Ошибка в regenerateImageAsync:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});
