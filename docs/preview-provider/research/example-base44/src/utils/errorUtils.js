/**
 * Извлекает понятное сообщение об ошибке из различных форматов ответов API
 *
 * Поддерживаемые форматы:
 * - Base44 SDK ошибки (error.data.error, error.data.message)
 * - HTTP ошибки со статусом (error.status, error.statusText)
 * - Стандартные JS ошибки (error.message)
 * - Ответы функций Base44 (response.data.error, response.data.message)
 * - Вложенные ошибки (error.data.extra_data)
 */

/**
 * Извлекает сообщение об ошибке из объекта ошибки или ответа API
 * @param {Error|Object} error - Объект ошибки или ответ API
 * @param {string} fallbackMessage - Сообщение по умолчанию, если не удалось извлечь ошибку
 * @returns {string} Понятное сообщение об ошибке
 */
export function extractErrorMessage(error, fallbackMessage = 'Произошла неизвестная ошибка') {
  if (!error) {
    return fallbackMessage;
  }

  // Если это строка - возвращаем как есть
  if (typeof error === 'string') {
    return error;
  }

  // Проверяем наличие вложенных данных ошибки (Base44 SDK формат)
  if (error.data) {
    // Приоритет: error > message > detail
    if (error.data.error && typeof error.data.error === 'string') {
      return error.data.error;
    }
    if (error.data.message && typeof error.data.message === 'string') {
      return error.data.message;
    }
    if (error.data.detail && typeof error.data.detail === 'string') {
      return error.data.detail;
    }
    // Проверяем extra_data для дополнительных деталей
    if (error.data.extra_data) {
      if (error.data.extra_data.message) {
        return error.data.extra_data.message;
      }
      if (error.data.extra_data.error) {
        return error.data.extra_data.error;
      }
      if (error.data.extra_data.reason) {
        return translateErrorReason(error.data.extra_data.reason);
      }
    }
  }

  // Стандартное JS сообщение об ошибке
  if (error.message && typeof error.message === 'string') {
    // Если message содержит только HTTP статус, пытаемся извлечь больше информации
    if (isHttpStatusMessage(error.message) && error.data) {
      const extracted = extractFromData(error.data);
      if (extracted) return extracted;
    }
    return error.message;
  }

  // HTTP статус-код с текстом
  if (error.status && error.statusText) {
    return `Ошибка ${error.status}: ${error.statusText}`;
  }

  // Только HTTP статус
  if (error.status) {
    return translateHttpStatus(error.status);
  }

  return fallbackMessage;
}

/**
 * Извлекает сообщение об ошибке из ответа функции Base44
 * Используется для response.data когда success = false
 * @param {Object} responseData - Данные ответа (response.data)
 * @param {string} fallbackMessage - Сообщение по умолчанию
 * @returns {string} Понятное сообщение об ошибке
 */
export function extractResponseError(responseData, fallbackMessage = 'Произошла ошибка при выполнении операции') {
  if (!responseData) {
    return fallbackMessage;
  }

  // Проверяем различные поля с сообщениями об ошибке
  if (responseData.error && typeof responseData.error === 'string') {
    return responseData.error;
  }
  if (responseData.message && typeof responseData.message === 'string') {
    return responseData.message;
  }
  if (responseData.detail && typeof responseData.detail === 'string') {
    return responseData.detail;
  }
  if (responseData.errors && Array.isArray(responseData.errors)) {
    return responseData.errors.map(e => typeof e === 'string' ? e : e.message || e.error).join('; ');
  }

  return fallbackMessage;
}

/**
 * Форматирует сообщение об ошибке для отображения пользователю
 * @param {string} prefix - Префикс сообщения (например, "Ошибка генерации")
 * @param {Error|Object} error - Объект ошибки
 * @returns {string} Отформатированное сообщение
 */
export function formatErrorMessage(prefix, error) {
  const message = extractErrorMessage(error);
  if (prefix) {
    return `${prefix}: ${message}`;
  }
  return message;
}

/**
 * Проверяет, является ли сообщение просто HTTP статусом
 */
function isHttpStatusMessage(message) {
  return /^(Request failed with status code \d+|\d{3})$/.test(message);
}

/**
 * Извлекает сообщение из объекта data
 */
function extractFromData(data) {
  if (typeof data === 'string') return data;
  if (data.error) return data.error;
  if (data.message) return data.message;
  if (data.detail) return data.detail;
  return null;
}

/**
 * Переводит HTTP статус-код в понятное сообщение
 */
function translateHttpStatus(status) {
  const statusMessages = {
    400: 'Некорректный запрос. Проверьте введённые данные.',
    401: 'Необходима авторизация. Пожалуйста, войдите в систему.',
    403: 'Доступ запрещён. У вас нет прав для выполнения этой операции.',
    404: 'Запрашиваемый ресурс не найден.',
    409: 'Конфликт данных. Возможно, такой ресурс уже существует.',
    422: 'Ошибка валидации данных. Проверьте правильность заполнения полей.',
    429: 'Слишком много запросов. Пожалуйста, подождите немного.',
    500: 'Внутренняя ошибка сервера. Попробуйте позже.',
    502: 'Сервер временно недоступен. Попробуйте позже.',
    503: 'Сервис временно недоступен. Попробуйте позже.',
    504: 'Время ожидания ответа истекло. Попробуйте позже.'
  };

  return statusMessages[status] || `Ошибка сервера (код ${status})`;
}

/**
 * Переводит причину ошибки в понятное сообщение
 */
function translateErrorReason(reason) {
  const reasonMessages = {
    'auth_required': 'Требуется авторизация',
    'user_not_registered': 'Пользователь не зарегистрирован',
    'invalid_token': 'Недействительный токен авторизации',
    'token_expired': 'Срок действия токена истёк',
    'permission_denied': 'Недостаточно прав для выполнения операции',
    'not_found': 'Запрашиваемый ресурс не найден',
    'validation_error': 'Ошибка валидации данных',
    'rate_limit': 'Превышен лимит запросов'
  };

  return reasonMessages[reason] || reason;
}
