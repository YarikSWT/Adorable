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

        if (!order.generated_images || order.generated_images.length === 0) {
            return Response.json({ error: 'No images to check' }, { status: 400 });
        }

        console.log('Order. generated_images:', order.generated_images);

        // Находим все изображения, которые нужно проверить:
        // - generating/pending - активная генерация
        // - failed - могла быть временная ошибка (429, сетевая ошибка и т.д.)
        const imagesToCheck = order.generated_images.filter(
            img => (img.status === 'generating') && img.async_task_id
        );

        if (imagesToCheck.length === 0) {
            // Все изображения уже завершены или нет задач для проверки
            return Response.json({
                all_completed: true,
                generating_count: 0,
                completed_count: order.generated_images.filter(img => img.status === 'generated').length,
                failed_count: order.generated_images.filter(img => img.status === 'failed').length
            });
        }

        console.log(`=== ПРОВЕРКА СТАТУСА ${imagesToCheck.length} ЗАДАЧ ===`);
        console.log(`Из них failed (переproверка): ${imagesToCheck.filter(img => img.status === 'failed').length}`);


        // Параллельно проверяем статус всех изображений
        const statusCheckPromises = imagesToCheck.map(async (image) => {
            try {
                const response = await fetch(
                    `https://async-byteplus.aom-tech.ru/api/status/${image.async_task_id}`,
                    {
                        method: 'GET',
                        headers: {
                            'Authorization': authHeader,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const result = await response.json();

                console.log(`Статус задачи ${image.async_task_id}:`, result.status, `(${result.progress}%)`);
                console.log(`Полный ответ API для задачи ${image.async_task_id}:`, JSON.stringify(result, null, 2));

                if (!response.ok) {
                    return {
                        imageId: image.id,
                        error: true,
                        errorMessage: result.message || 'Status check failed',
                        errorDetails: {
                            status_code: response.status,
                            status_text: response.statusText,
                            error_code: result.code || result.error_code || 'UNKNOWN',
                            error_message: result.message || result.error || 'Status check failed',
                            timestamp: new Date().toISOString()
                        }
                    };
                }

                // Пробуем разные варианты структуры ответа
                let imageUrl = null;
                if (result.result?.images?.[0]) {
                    imageUrl = result.result.images[0];
                } else if (result.result?.url) {
                    imageUrl = result.result.url;
                } else if (result.image_url) {
                    imageUrl = result.image_url;
                } else if (result.url) {
                    imageUrl = result.url;
                } else if (result.data?.[0]?.url) {
                    imageUrl = result.data[0].url;
                }

                console.log(`Извлечённый URL для задачи ${image.async_task_id}:`, imageUrl);

                return {
                    imageId: image.id,
                    taskId: result.task_id,
                    status: result.status,
                    progress: result.progress || 0,
                    imageUrl: imageUrl,
                    error: false
                };

            } catch (error) {
                console.error(`Ошибка при проверке статуса ${image.async_task_id}:`, error);
                return {
                    imageId: image.id,
                    error: true,
                    errorMessage: error.message,
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

        // Ждём все проверки статусов
        const statusResults = await Promise.all(statusCheckPromises);

        // Обновляем generated_images на основе полученных статусов (с async обработкой)
        const updatePromises = order.generated_images.map(async (img) => {
            const statusResult = statusResults.find(r => r.imageId === img.id);
            
            if (!statusResult) {
                // Это изображение не проверялось (не в статусе generating)
                return img;
            }

            if (statusResult.error) {
                // Ошибка при проверке статуса
                return {
                    ...img,
                    status: 'failed',
                    error: statusResult.errorMessage,
                    error_details: statusResult.errorDetails
                };
            }

            // Обновляем на основе статуса от API
            if (statusResult.status === 'completed') {
                // Логируем восстановление после ошибки
                if (img.status === 'failed') {
                    console.log(`✅ Изображение ${img.id} восстановлено после ошибки! Генерация успешно завершена.`);
                }
                
                // Проверяем наличие URL изображения
                if (!statusResult.imageUrl) {
                    console.error(`❌ Изображение ${img.id} завершено, но URL отсутствует в ответе API`);
                    return {
                        ...img,
                        status: 'failed',
                        error: 'Image URL not provided by API',
                        error_details: {
                            status_code: 0,
                            status_text: 'Missing URL',
                            error_code: 'MISSING_URL',
                            error_message: 'Generation completed but image URL is missing',
                            timestamp: new Date().toISOString()
                        },
                        progress: 100
                    };
                }
                
                // Скачиваем и сохраняем изображение в хранилище Base44
                let savedImageUrl = statusResult.imageUrl;
                try {
                    console.log(`Загрузка изображения ${img.id} в хранилище...`);
                    console.log(`Исходный URL: ${statusResult.imageUrl}`);
                    
                    // Скачиваем изображение
                    const imageResponse = await fetch(statusResult.imageUrl);
                    
                    if (!imageResponse.ok) {
                        throw new Error(`Failed to fetch image: ${imageResponse.status} ${imageResponse.statusText}`);
                    }
                    
                    // Получаем blob
                    const imageBlob = await imageResponse.blob();
                    
                    // Проверяем, что blob не пустой
                    if (!imageBlob || imageBlob.size === 0) {
                        throw new Error('Downloaded image blob is empty');
                    }
                    
                    console.log(`Изображение скачано, размер: ${imageBlob.size} байт, тип: ${imageBlob.type}`);
                    
                    // Создаем File объект из blob (как в рабочем примере)
                    const imageFile = new File([imageBlob], 'image.jpg', { type: 'image/jpeg' });
                    
                    // Загружаем в Base44 хранилище
                    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({
                        file: imageFile
                    });
                    
                    savedImageUrl = uploadResult.file_url;
                    console.log(`✅ Изображение ${img.id} сохранено в base44:`, savedImageUrl);
                } catch (uploadError) {
                    console.error(`❌ Ошибка загрузки изображения ${img.id} в хранилище:`, uploadError);
                    console.error(`Детали ошибки:`, {
                        message: uploadError.message,
                        name: uploadError.name,
                        status: uploadError.status,
                        data: uploadError.data
                    });
                    // Продолжаем с оригинальным URL если загрузка не удалась
                    console.log(`Используется оригинальный URL: ${savedImageUrl}`);
                }
                
                const updatedImage = {
                    ...img,
                    status: 'generated',
                    image_url: savedImageUrl,
                    progress: 100
                };
                
                console.log(`Обновлённое изображение ${img.id}:`, {
                    id: updatedImage.id,
                    status: updatedImage.status,
                    image_url: updatedImage.image_url,
                    has_url: !!updatedImage.image_url
                });
                
                return updatedImage;
            } else if (statusResult.status === 'failed') {
                return {
                    ...img,
                    status: 'failed',
                    error: 'Generation failed',
                    error_details: {
                        status_code: 0,
                        status_text: 'Generation Failed',
                        error_code: 'GENERATION_FAILED',
                        error_message: 'Image generation task failed on server',
                        timestamp: new Date().toISOString()
                    },
                    progress: statusResult.progress
                };
            } else {
                // pending или processing - обновляем прогресс
                // Логируем восстановление после ошибки
                if (img.status === 'failed') {
                    console.log(`🔄 Изображение ${img.id} восстановлено после ошибки! Статус: ${statusResult.status}, прогресс: ${statusResult.progress}%`);
                }
                return {
                    ...img,
                    status: 'generating',
                    progress: statusResult.progress
                };
            }
        });
        
        const updatedImages = await Promise.all(updatePromises);

        // Подсчитываем статистику
        const generatingCount = updatedImages.filter(img => img.status === 'generating').length;
        const completedCount = updatedImages.filter(img => img.status === 'generated').length;
        const failedCount = updatedImages.filter(img => img.status === 'failed').length;
        const allCompleted = generatingCount === 0;

        // Подготавливаем данные для обновления Order (все изменения в одном запросе)

        /*{
            generated_images: typeof updatedImages;
            status?: string;
            progress?: number;
        } */
        const updateData = {
            generated_images: updatedImages
        };

        // Если все завершены, обновляем статус заказа
        if (allCompleted) {
            updateData.status = 'review';
            updateData.progress = 100;
            console.log('Все изображения завершены. Статус заказа обновлён на "review"');
        } else {
            // Обновляем прогресс заказа
            const totalImages = updatedImages.length;
            updateData.progress = Math.round(((completedCount + failedCount) / totalImages) * 100);
        }

        // Сохраняем все обновлённые данные в БД одним запросом
        console.log('=== ОБНОВЛЕНИЕ ORDER ===');
        console.log('Order ID:', orderId);
        console.log('Данные для обновления:', JSON.stringify(updateData, null, 2));
        console.log('Изображения с URL:', updatedImages.filter(img => img.image_url).map(img => ({
            id: img.id,
            status: img.status,
            image_url: img.image_url
        })));
        console.log('Изображения без URL:', updatedImages.filter(img => !img.image_url).map(img => ({
            id: img.id,
            status: img.status
        })));
        
        await base44.asServiceRole.entities.Order.update(orderId, updateData);
        
        console.log('✅ Order успешно обновлён в БД');

        console.log(`=== РЕЗУЛЬТАТ ПРОВЕРКИ ===`);
        console.log(`Генерируется: ${generatingCount}`);
        console.log(`Готово: ${completedCount}`);
        console.log(`Ошибка: ${failedCount}`);
        
        return Response.json({
            success: true,
            all_completed: allCompleted,
            generating_count: generatingCount,
            completed_count: completedCount,
            failed_count: failedCount,
            images: updatedImages
        });

    } catch (error) {
        console.error('Ошибка в checkGenerationStatus:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});