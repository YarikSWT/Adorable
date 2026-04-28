import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { packageId, testImageUrl } = await req.json();

        if (!packageId) {
            return Response.json({ error: 'Package ID is required' }, { status: 400 });
        }

        // Проверяем наличие auth token для async API
        const authToken = Deno.env.get("ASYNC_BYTEPLUS_AUTH_TOKEN");
        
        if (!authToken) {
            return Response.json({ error: 'Async API auth token not configured' }, { status: 500 });
        }

        // Создаём Basic Auth header (токен как username, пароль пустой)
        const authHeader = `Basic ${authToken}`;

        // Получаем пакет шаблонов
        const packages = await base44.entities.TemplatePackage.filter({ id: packageId });
        const pkg = packages[0];

        if (!pkg || !pkg.templates || pkg.templates.length === 0) {
            return Response.json({ error: 'Template package not found or empty' }, { status: 404 });
        }

        // Используем test_image_url из пакета, если не передан явно
        const imageUrl = testImageUrl || pkg.test_image_url;

        // Функция замены переменных в промпте (используем тестовые значения)
        const replaceVariables = (prompt) => {
            return prompt
                .replace(/\[имя\]/g, 'Александр')
                .replace(/\[вес\]/g, '3.5 kg')
                .replace(/\[рост\]/g, '52 cm')
                .replace(/\[дата\]/g, '15.01.2025')
                .replace(/\[время\]/g, '10:30');
        };

        console.log('=== ЗАПУСК ГЕНЕРАЦИИ ПРИМЕРОВ ДЛЯ ШАБЛОНОВ ===');
        console.log('Количество шаблонов:', pkg.templates.length);
        console.log('Тестовое изображение:', imageUrl || 'не указано');

        // Параллельный запуск генерации для всех шаблонов
        const generationPromises = pkg.templates.map(async (template, index) => {
            try {
                const finalPrompt = replaceVariables(template.prompt);
                
                const requestBody = {
                    model: 'seedream-4-5-251128',
                    prompt: finalPrompt,
                    size: '2K',
                    sequential_image_generation: 'disabled',
                    response_format: 'url',
                    stream: false,
                    watermark: false
                };

                // Добавляем изображение только если оно есть
                if (imageUrl) {
                    requestBody.image = [imageUrl];
                }

                console.log(`Запуск генерации для шаблона ${index + 1} (${template.id}):`, template.name);

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
                    success: true,
                    taskId: result.task_id
                };

            } catch (error) {
                console.error(`Ошибка при генерации шаблона ${index + 1}:`, error);
                return {
                    templateId: template.id,
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

        // Ждём завершения всех запросов на запуск
        const startResults = await Promise.all(generationPromises);

        console.log(`=== ЗАПУСК ЗАВЕРШЕН ===`);
        console.log(`Успешно запущено: ${startResults.filter(r => r.success).length}`);
        console.log(`Не удалось запустить: ${startResults.filter(r => !r.success).length}`);

        // Теперь ждём завершения генерации для всех успешно запущенных задач
        const tasksToWait = startResults.filter(r => r.success && r.taskId);
        
        if (tasksToWait.length === 0) {
            return Response.json({
                success: false,
                error: 'Не удалось запустить генерацию ни для одного шаблона',
                results: startResults
            });
        }

        console.log(`=== ОЖИДАНИЕ ЗАВЕРШЕНИЯ ${tasksToWait.length} ЗАДАЧ ===`);

        // Функция для проверки статуса задачи
        const checkTaskStatus = async (taskId) => {
            const response = await fetch(
                `https://async-byteplus.aom-tech.ru/api/status/${taskId}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Status check failed: ${response.statusText}`);
            }

            const result = await response.json();
            return {
                status: result.status,
                progress: result.progress || 0,
                imageUrl: result.result?.images?.[0] || null
            };
        };

        // Функция для ожидания завершения задачи с polling
        const waitForTask = async (taskId, maxWaitTime) => {
            const startTime = Date.now();
            const pollInterval = 3000; // Проверяем каждые 3 секунды

            while (Date.now() - startTime < maxWaitTime) {
                try {
                    const status = await checkTaskStatus(taskId);
                    
                    if (status.status === 'completed') {
                        return status.imageUrl || null;
                    } else if (status.status === 'failed') {
                        throw new Error('Generation task failed');
                    }
                    
                    // Ждём перед следующей проверкой
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                } catch (error) {
                    console.error(`Ошибка при проверке статуса задачи ${taskId}:`, error);
                    throw error;
                }
            }

            throw new Error('Timeout waiting for task completion');
        };

        // Ждём завершения всех задач
        const finalResults = await Promise.allSettled(
            tasksToWait.map(async (startResult) => {
                try {
                    const imageUrl = await waitForTask(startResult.taskId);
                    return {
                        templateId: startResult.templateId,
                        success: true,
                        imageUrl: imageUrl
                    };
                } catch (error) {
                    return {
                        templateId: startResult.templateId,
                        success: false,
                        error: error.message
                    };
                }
            })
        );

        // Обрабатываем результаты
        const processedResults = finalResults.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                return {
                    templateId: tasksToWait[index].templateId,
                    success: false,
                    error: result.reason?.message || 'Unknown error'
                };
            }
        });

        // Объединяем результаты запуска и завершения
        const allResults = startResults.map(startResult => {
            if (!startResult.success) {
                return startResult;
            }
            
            const finalResult = processedResults.find(r => r.templateId === startResult.templateId);
            if (finalResult) {
                return finalResult;
            }
            
            return {
                templateId: startResult.templateId,
                success: false,
                error: 'Final result not found'
            };
        });

        // Обновляем preview_url для каждого шаблона
        const updatedTemplates = pkg.templates.map(template => {
            const result = allResults.find(r => r.templateId === template.id);
            if (result && result.success && result.imageUrl) {
                return {
                    ...template,
                    preview_url: result.imageUrl
                };
            }
            return template;
        });

        // Сохраняем обновлённые шаблоны в БД
        // Сохраняем загруженное тестовое изображение, а не сгенерированное
        const testImageToSave = testImageUrl || pkg.test_image_url;
        const updateData = {
            templates: updatedTemplates
        };
        // Обновляем test_image_url только если есть значение
        if (testImageToSave) {
            updateData.test_image_url = testImageToSave;
        }
        await base44.asServiceRole.entities.TemplatePackage.update(packageId, updateData);

        const successCount = allResults.filter(r => r.success).length;
        const failedCount = allResults.filter(r => !r.success).length;

        console.log(`=== РЕЗУЛЬТАТ ГЕНЕРАЦИИ ===`);
        console.log(`Успешно: ${successCount}`);
        console.log(`Ошибок: ${failedCount}`);

        return Response.json({
            success: true,
            success_count: successCount,
            failed_count: failedCount,
            total_count: pkg.templates.length,
            results: allResults
        });

    } catch (error) {
        console.error('Ошибка в generateTemplatePreviews:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});
