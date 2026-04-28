import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { packageId, templateId, testImageUrl } = await req.json();

        if (!packageId) {
            return Response.json({ error: 'Package ID is required' }, { status: 400 });
        }

        if (!templateId) {
            return Response.json({ error: 'Template ID is required' }, { status: 400 });
        }

        const apiKey = Deno.env.get("SEEDDREAM_API_KEY");
        if (!apiKey) {
            return Response.json({ error: 'SeedDream API key not configured' }, { status: 500 });
        }

        // Получаем пакет шаблонов
        const packages = await base44.entities.TemplatePackage.filter({ id: packageId });
        const pkg = packages[0];

        if (!pkg || !pkg.templates || pkg.templates.length === 0) {
            return Response.json({ error: 'Template package not found or empty' }, { status: 404 });
        }

        // Находим нужный шаблон
        const template = pkg.templates.find(t => t.id === templateId);
        if (!template) {
            return Response.json({ error: 'Template not found' }, { status: 404 });
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

        console.log('=== ЗАПУСК ГЕНЕРАЦИИ ПРИМЕРА ДЛЯ ШАБЛОНА ===');
        console.log('Шаблон:', template.name, template.id);
        console.log('Тестовое изображение:', imageUrl || 'не указано');

        const finalPrompt = replaceVariables(template.prompt);
        
        const requestBody = {
            model: 'seedream-4-5-251128',
            prompt: finalPrompt,
            size: '2048x2048',
            sequential_image_generation: 'disabled',
            response_format: 'url',
            watermark: false
        };

        // Добавляем изображение только если оно есть
        if (imageUrl) {
            requestBody.image = [imageUrl];
        }

        console.log('Запрос генерации:', template.name);

        const response = await fetch('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        console.log('Ответ:', result);

        if (!response.ok) {
            return Response.json({
                success: false,
                error: result.error?.message || 'Generation failed',
                errorDetails: {
                    status_code: response.status,
                    status_text: response.statusText,
                    error_code: result.error?.code || 'UNKNOWN',
                    error_message: result.error?.message || 'Generation failed',
                    timestamp: new Date().toISOString()
                }
            }, { status: response.status });
        }

        if (!result.data || result.data.length === 0) {
            return Response.json({
                success: false,
                error: 'No image data in response'
            }, { status: 500 });
        }

        const generatedImageUrl = result.data[0].url;
        
        console.log('=== ЗАГРУЗКА ИЗОБРАЖЕНИЯ В ХРАНИЛИЩЕ ===');
        
        // Скачиваем сгенерированное изображение
        const imageResponse = await fetch(generatedImageUrl);
        const imageBlob = await imageResponse.blob();
        
        // Загружаем в Base44 хранилище
        const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({
            file: imageBlob
        });
        
        const previewImageUrl = uploadResult.file_url;
        console.log('Изображение сохранено:', previewImageUrl);

        // Обновляем preview_url для шаблона
        const updatedTemplates = pkg.templates.map(t => {
            if (t.id === templateId) {
                return {
                    ...t,
                    preview_url: previewImageUrl
                };
            }
            return t;
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

        console.log('=== ГЕНЕРАЦИЯ ЗАВЕРШЕНА УСПЕШНО ===');
        console.log('URL изображения:', previewImageUrl);

        return Response.json({
            success: true,
            templateId: templateId,
            imageUrl: previewImageUrl
        });

    } catch (error) {
        console.error('Ошибка в generateTemplatePreview:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});