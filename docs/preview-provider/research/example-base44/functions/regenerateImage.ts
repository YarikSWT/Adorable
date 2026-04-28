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

        // Обновляем статус изображения на "regenerating"
        const updatedImages = order.generated_images.map(img =>
            img.id === imageId ? { ...img, status: 'regenerating' } : img
        );
        await base44.asServiceRole.entities.Order.update(orderId, { generated_images: updatedImages });

        // Генерируем новое изображение
        const requestBody = {
            model: 'seedream-4-5-251128',
            prompt: finalPrompt,
            image: order.photos,
            size: '2048x2048',
            sequential_image_generation: 'disabled',
            response_format: 'url',
            watermark: false
        };

        const response = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (!response.ok) {
            // Обновляем статус на failed
            const failedImages = order.generated_images.map(img =>
                img.id === imageId ? { 
                    ...img, 
                    status: 'failed',
                    error: result.error?.message || 'Regeneration failed',
                    error_details: {
                        status_code: response.status,
                        status_text: response.statusText,
                        error_code: result.error?.code || null,
                        error_type: result.error?.type || null,
                        full_error: result.error || null
                    }
                } : img
            );
            await base44.asServiceRole.entities.Order.update(orderId, { generated_images: failedImages });
            
            return Response.json({ error: result.error?.message || 'Generation failed' }, { status: 500 });
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
            
            // Обновляем изображение с новым URL из base44
            const regeneratedImages = order.generated_images.map(img =>
                img.id === imageId ? {
                    ...img,
                    image_url: savedImageUrl,
                    status: 'generated',
                    seed_dream_task_id: result.data[0].id || null
                } : img
            );
            
            await base44.asServiceRole.entities.Order.update(orderId, { generated_images: regeneratedImages });

            return Response.json({ 
                success: true,
                image_url: savedImageUrl
            });
        }

        return Response.json({ error: 'No image generated' }, { status: 500 });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});