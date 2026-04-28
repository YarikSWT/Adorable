import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // НЕ проверяем авторизацию - страница должна быть доступна без авторизации
        const url = new URL(req.url);
        const orderId = url.searchParams.get('orderId');

        if (!orderId) {
            return new Response('Order ID is required', { status: 400 });
        }

        // Получаем заказ (используем asServiceRole для доступа без авторизации)
        const orders = await base44.asServiceRole.entities.Order.filter({ id: orderId });
        const order = orders[0];

        if (!order) {
            return new Response('Order not found', { status: 404 });
        }

        const previewImages = order.preview_images || [];

        if (previewImages.length === 0) {
            return new Response('Preview not available for this order', { status: 404 });
        }

        // Загружаем продающий текст для альбомов
        let sellingText = '';
        try {
            const sellingTexts = await base44.asServiceRole.entities.AlbumSellingText.filter({ 
                is_active: true 
            });
            if (sellingTexts.length > 0) {
                sellingText = sellingTexts[0].selling_text || '';
            }
        } catch (error) {
            console.error('Ошибка загрузки продающего текста:', error);
        }

        // Функция для замены плейсхолдеров в тексте
        const replacePlaceholders = (text) => {
            return text
                .replace(/\{\{baby_name\}\}/g, order.baby_name || 'Ребенок')
                .replace(/\{\{baby_gender\}\}/g, order.baby_gender === 'boy' ? 'Мальчик' : order.baby_gender === 'girl' ? 'Девочка' : 'Ребенок')
                .replace(/\{\{baby_weight\}\}/g, order.baby_weight ? `${order.baby_weight} кг` : '')
                .replace(/\{\{baby_height\}\}/g, order.baby_height ? `${order.baby_height} см` : '')
                .replace(/\{\{birth_date\}\}/g, order.birth_date || '')
                .replace(/\{\{birth_time\}\}/g, order.birth_time || '')
                .replace(/\{\{album_preview_url\}\}/g, order.album_preview_image || '')
                .replace(/\{\{archive_url\}\}/g, order.archive_url || '');
        };

        // Генерируем HTML страницу
        const html = `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Превью заказа #${order.order_number || orderId}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(to bottom, #f8fafc, #e2e8f0);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .header {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .header h1 {
            color: #1e293b;
            font-size: 28px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .header p {
            color: #64748b;
            font-size: 14px;
        }
        .gallery {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 16px;
        }
        .image-item {
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .image-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .image-item img {
            width: 100%;
            height: auto;
            display: block;
        }
        .album-preview {
            max-width: 300px;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .album-preview img {
            width: 100%;
            height: auto;
            display: block;
        }
        .selling-section {
            margin-top: 40px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            border-radius: 12px;
            padding: 30px;
            color: white;
            text-align: center;
        }
        .selling-title {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .selling-description {
            font-size: 16px;
            line-height: 1.5;
            margin-bottom: 24px;
        }
        .album-preview-container {
            display: flex;
            justify-content: center;
            margin-top: 24px;
        }
        @media (max-width: 768px) {
            .gallery {
                grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                gap: 12px;
            }
            .header h1 {
                font-size: 24px;
            }
            .selling-section {
                padding: 20px;
            }
            .selling-title {
                font-size: 20px;
            }
            .selling-description {
                font-size: 14px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Превью заказа #${order.order_number || orderId}</h1>
            <p>Миниатюры сгенерированных изображений (${previewImages.length} шт.)</p>
        </div>
        <div class="gallery">
            ${previewImages.map((imageUrl, index) => `
                <div class="image-item">
                    <img src="${imageUrl}" alt="Изображение ${index + 1}" loading="lazy">
                </div>
            `).join('')}
        </div>
        
        ${sellingText && order.album_preview_image ? `
        <div class="selling-section">
            <h2 class="selling-title">${replacePlaceholders(sellingText.split('\n')[0] || '')}</h2>
            <div class="selling-description">${replacePlaceholders(sellingText.split('\n').slice(1).join('\n'))}</div>
            
            ${order.album_preview_image ? `
            <div class="album-preview-container">
                <div class="album-preview">
                    <img src="${order.album_preview_image}" alt="Превью печатного альбома">
                </div>
            </div>
            ` : ''}
        </div>
        ` : ''}
    </div>
</body>
</html>`;

        return new Response(html, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
            },
        });

    } catch (error) {
        console.error('Ошибка в getOrderPreview:', error);
        return new Response('Internal server error', { status: 500 });
    }
});
