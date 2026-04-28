import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import JSZip from 'npm:jszip@3.10.1';

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

        // Получаем только одобренные или сгенерированные изображения (не удалённые)
        const approvedImages = order.generated_images?.filter(
            img => (img.status === 'approved' || img.status === 'generated') && img.image_url
        ) || [];

        if (approvedImages.length === 0) {
            return Response.json({ error: 'No approved images to archive' }, { status: 400 });
        }

        // Создаём ZIP архив
        const zip = new JSZip();

        // Скачиваем и добавляем изображения в архив
        for (let i = 0; i < approvedImages.length; i++) {
            const image = approvedImages[i];
            try {
                const response = await fetch(image.image_url);
                const blob = await response.blob();
                const arrayBuffer = await blob.arrayBuffer();
                
                // Добавляем в ZIP с номером
                zip.file(`image_${i + 1}.jpg`, arrayBuffer);
            } catch (error) {
                console.error(`Failed to download image ${image.id}:`, error);
            }
        }

        // Генерируем ZIP файл
        const zipBlob = await zip.generateAsync({ type: 'uint8array' });

        // Функция для очистки имени файла от недопустимых символов
        const sanitizeFileName = (name: string): string => {
            if (!name) return '';
            // Заменяем пробелы на подчеркивания и удаляем недопустимые символы
            return name
                .replace(/\s+/g, '_')
                .replace(/[\/\\:*?"<>|]/g, '')
                .trim();
        };

        // Формируем имя архива: <НомерЗаказа>_<ИмяМамы>_<Контакт>__<id>.zip
        const orderNumber = sanitizeFileName(order.order_number || '');
        const motherName = sanitizeFileName(order.mother_name || '');
        const contact = sanitizeFileName(order.mother_phone || '');
        const orderIdValue = order.id || orderId;
        
        const archiveFileName = `${orderNumber}_${motherName}_${contact}__${orderIdValue}.zip`;

        // Загружаем ZIP на хранилище Base44
        const file = new File([zipBlob], archiveFileName, { type: 'application/zip' });
        const { file_url } = await base44.integrations.Core.UploadFile({ file });

        // Обновляем заказ
        await base44.entities.Order.update(orderId, {
            status: 'completed',
            archive_url: file_url
        });

        return Response.json({ 
            success: true,
            archive_url: file_url,
            images_count: approvedImages.length
        });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});