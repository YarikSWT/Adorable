import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

/**
 * Загружает активный шаблон приветственного сообщения
 * @returns {Promise<string>} Текст шаблона или дефолтный текст
 */
export async function getActiveTemplate() {
  try {
    const templates = await base44.entities.ArchiveMessageTemplate.filter({ 
      is_active: true 
    });
    
    if (templates.length > 0) {
      return templates[0].template_text || getDefaultTemplate();
    }
    
    return getDefaultTemplate();
  } catch (error) {
    console.error('Ошибка загрузки шаблона:', error);
    return getDefaultTemplate();
  }
}

/**
 * Дефолтный шаблон приветственного сообщения
 * @returns {string}
 */
function getDefaultTemplate() {
  return `Здравствуйте!

Ваш архив с фотографиями готов!

{{baby_name}}
{{baby_gender}}
{{baby_weight}}
{{baby_height}}
{{birth_date}}
{{birth_time}}

Ссылка на архив: {{archive_url}}`;
}

/**
 * Форматирует дату рождения
 * @param {string} date - Дата в формате ISO
 * @param {string} time - Время рождения (опционально)
 * @returns {string}
 */
export function formatBirthDate(date, time) {
  if (!date) return '';
  
  try {
    const formattedDate = format(new Date(date), "d MMMM yyyy", { locale: ru });
    return time ? `${formattedDate} в ${time}` : formattedDate;
  } catch (error) {
    console.error('Ошибка форматирования даты:', error);
    return date;
  }
}

/**
 * Форматирует пол ребенка
 * @param {string} gender - 'boy' или 'girl'
 * @returns {string}
 */
export function formatBabyGender(gender) {
  if (!gender) return '';
  return gender === 'boy' ? 'Мальчик' : 'Девочка';
}

/**
 * Форматирует вес ребенка
 * @param {number} weight - Вес в кг
 * @returns {string}
 */
export function formatBabyWeight(weight) {
  if (!weight) return '';
  return `${weight} кг`;
}

/**
 * Форматирует рост ребенка
 * @param {number} height - Рост в см
 * @returns {string}
 */
export function formatBabyHeight(height) {
  if (!height) return '';
  return `${height} см`;
}

/**
 * Заменяет плейсхолдеры в шаблоне значениями из заказа
 * @param {string} template - Текст шаблона с плейсхолдерами
 * @param {Object} order - Объект заказа
 * @returns {string}
 */
export function replacePlaceholders(template, order) {
  if (!template || !order) return '';
  
  let result = template;
  
  // Заменяем плейсхолдеры
  const replacements = {
    '{{baby_name}}': order.baby_name || 'не указано',
    '{{baby_gender}}': formatBabyGender(order.baby_gender),
    '{{baby_weight}}': formatBabyWeight(order.baby_weight),
    '{{baby_height}}': formatBabyHeight(order.baby_height),
    '{{birth_date}}': formatBirthDate(order.birth_date, order.birth_time),
    '{{birth_time}}': order.birth_time || '',
    '{{archive_url}}': order.archive_url || ''
  };
  
  // Выполняем замену всех плейсхолдеров
  Object.keys(replacements).forEach(placeholder => {
    const value = replacements[placeholder];
    result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
  });
  
  return result;
}

/**
 * Генерирует финальное сообщение для копирования
 * @param {Object} order - Объект заказа
 * @returns {Promise<string>}
 */
export async function generateArchiveMessage(order) {
  const template = await getActiveTemplate();
  return replacePlaceholders(template, order);
}
