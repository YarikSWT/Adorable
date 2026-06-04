// Устанавливает JWT в правильный ключ localStorage для base44.
// Ключ определён экспериментально — см. auth-log.md.
// Использование: browser_evaluate с заменой __TOKEN__ на реальный JWT.
((token) => {
  const before = Object.keys(localStorage);
  localStorage.setItem('token', token);
  return {
    keysBefore: before,
    keyUsed: 'token',
    valuePreview: token.slice(0, 20) + '...' + token.slice(-8),
    href: location.href,
  };
})('__TOKEN__');
