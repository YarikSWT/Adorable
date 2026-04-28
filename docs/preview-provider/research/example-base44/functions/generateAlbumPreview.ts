import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { orderId, photoUrl, prompt } = await req.json();

        if (!orderId) {
            return Response.json({ error: 'Order ID is required' }, { status: 400 });
        }

        if (!photoUrl) {
            return Response.json({ error: 'Photo URL is required' }, { status: 400 });
        }

        if (!prompt) {
            return Response.json({ error: 'Prompt is required' }, { status: 400 });
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

        console.log('=== ЗАПРОС К SEEDDREAM API ДЛЯ ГЕНЕРАЦИИ МОКАПА АЛЬБОМА ===');
        console.log('Order ID:', orderId);
        console.log('Photo URL:', photoUrl.substring(0, 100));
        console.log('Prompt:', prompt);

        const requestBody = {
            model: 'seedream-4-5-251128',
            prompt: prompt,
            image: photoUrl,
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

        console.log('=== ОТВЕТ ОТ SEEDDREAM API ===');
        console.log('Статус:', response.status, response.statusText);
        
        const result = await response.json();
        console.log('Тело ответа:', JSON.stringify(result, null, 2));

        if (!response.ok) {
            return Response.json({ 
                success: false,
                error: result.error?.message || 'Album preview generation failed',
                orderId: orderId
            }, { status: response.status });
        }

        if (result.data && result.data.length > 0) {
            const generatedImageUrl = result.data[0].url;
            
            // Скачиваем и сохраняем изображение в хранилище Base44
            let savedImageUrl = generatedImageUrl;
            try {
                console.log('Загрузка мокапа альбома в хранилище...');
                const imageResponse = await fetch(generatedImageUrl);
                
                if (!imageResponse.ok) {
                    throw new Error(`Failed to fetch album preview: ${imageResponse.status} ${imageResponse.statusText}`);
                }
                
                // Получаем blob
                const imageBlob = await imageResponse.blob();
                
                // Проверяем, что blob не пустой
                if (!imageBlob || imageBlob.size === 0) {
                    throw new Error('Downloaded album preview blob is empty');
                }
                
                console.log(`Мокап альбома скачан, размер: ${imageBlob.size} байт, тип: ${imageBlob.type}`);
                
                // Создаем File объект из blob
                const imageFile = new File([imageBlob], 'album_preview.jpg', { type: 'image/jpeg' });
                
                // Загружаем в Base44 хранилище
                const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({
                    file: imageFile
                });
                
                savedImageUrl = uploadResult.file_url;
                console.log('✅ Мокап альбома сохранен в base44:', savedImageUrl);
            } catch (uploadError) {
                console.error('Ошибка загрузки мокапа альбома в хранилище:', uploadError);
                // Продолжаем с оригинальным URL если загрузка не удалась
                console.log('Используется оригинальный URL:', savedImageUrl);
            }
            
            // Обновляем Order с URL превью альбома
            await base44.asServiceRole.entities.Order.update(orderId, {
                album_preview_image: savedImageUrl,
                selected_photo_for_album_preview: photoUrl
            });
            
            return Response.json({ 
                success: true,
                album_preview_image: savedImageUrl,
                orderId: orderId
            });
        }

        return Response.json({ 
            success: false,
            error: 'No image data in response',
            orderId: orderId
        }, { status: 500 });

    } catch (error) {
        console.error('Ошибка в generateAlbumPreview:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }

});