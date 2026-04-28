import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

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

        // Получаем заказ
        const orders = await base44.entities.Order.filter({ id: orderId });
        const order = orders[0];

        if (!order) {
            return Response.json({ error: 'Order not found' }, { status: 404 });
        }

        // Получаем только сгенерированные или одобренные изображения (не удалённые)
        const imagesToPreview = order.generated_images?.filter(
            img => (img.status === 'generated' || img.status === 'approved') && img.image_url
        ) || [];

        if (imagesToPreview.length === 0) {
            return Response.json({ error: 'No images to create preview for' }, { status: 400 });
        }

        const previewImages = [];

        // Создаём миниатюры для каждого изображения
        for (let i = 0; i < imagesToPreview.length; i++) {
            const image = imagesToPreview[i];
            try {
                console.log(`Обработка изображения ${i + 1}/${imagesToPreview.length}: ${image.id}`);
                
                // Скачиваем оригинальное изображение
                const imageResponse = await fetch(image.image_url);
                if (!imageResponse.ok) {
                    console.error(`Не удалось скачать изображение ${image.id}: ${imageResponse.status}`);
                    continue;
                }

                const imageArrayBuffer = await imageResponse.arrayBuffer();
                
                // Создаём изображение из буфера
                const originalImage = await Image.decode(imageArrayBuffer);
                
                // Вычисляем размеры для миниатюры (максимум 300x300, сохраняя пропорции)
                const maxSize = 300;
                let width = originalImage.width;
                let height = originalImage.height;
                
                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round((height * maxSize) / width);
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round((width * maxSize) / height);
                        height = maxSize;
                    }
                }

                // Создаём миниатюру
                const thumbnail = originalImage.resize(width, height);
                
                // Кодируем миниатюру в JPEG с низким качеством
                // Используем encodeJPEG если доступен, иначе encode
                let thumbnailBuffer;
                if (typeof thumbnail.encodeJPEG === 'function') {
                    thumbnailBuffer = await thumbnail.encodeJPEG(70); // quality 70 из 100
                } else {
                    // Fallback для старой версии API
                    thumbnailBuffer = await thumbnail.encode();
                }
                
                // Создаём File объект для загрузки
                const thumbnailFile = new File([thumbnailBuffer], `preview_${image.id}.jpg`, { type: 'image/jpeg' });
                
                // Загружаем миниатюру в Base44 хранилище
                const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({
                    file: thumbnailFile
                });
                
                previewImages.push(uploadResult.file_url);
                console.log(`Миниатюра создана и сохранена: ${uploadResult.file_url}`);
                
            } catch (error) {
                console.error(`Ошибка при создании миниатюры для изображения ${image.id}:`, error);
                // Продолжаем обработку остальных изображений
            }
        }

        if (previewImages.length === 0) {
            return Response.json({ error: 'Failed to create any preview images' }, { status: 500 });
        }

        // Формируем URL для страницы превью
        // Получаем публичный домен приложения из заголовка Origin или из URL
        const origin = req.headers.get('origin') || req.headers.get('referer');
        let appDomain;
        
        if (origin) {
            // Извлекаем домен из Origin/Referer
            const originUrl = new URL(origin);
            appDomain = originUrl.host;
        } else {
            // Fallback: используем домен из текущего запроса
            const url = new URL(req.url);
            appDomain = url.host;
        }
        
        const previewUrl = `https://${appDomain}/api/functions/getOrderPreview?orderId=${orderId}`;

        // Обновляем заказ с превью изображениями и URL
        await base44.asServiceRole.entities.Order.update(orderId, {
            preview_images: previewImages,
            preview_url: previewUrl
        });

        return Response.json({ 
            success: true,
            preview_images: previewImages,
            preview_url: previewUrl,
            images_count: previewImages.length
        });

    } catch (error) {
        console.error('Ошибка в createOrderPreview:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});