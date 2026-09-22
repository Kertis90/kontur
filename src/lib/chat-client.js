export async function chatRequest(path, options = {}) {
  const response = await fetch(path, {...options, headers: {'content-type': 'application/json', ...options.headers}});
  const value = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(value.error || 'Не удалось связаться с сервером'); error.status = response.status; throw error; }
  return value;
}
export function mergeChatMessages(current, incoming) {
  const messages = new Map(current.map(message => [Number(message.id), message]));
  for (const message of incoming) messages.set(Number(message.id), message);
  return [...messages.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
export function atChatBottom(element) {
  return Boolean(element && element.scrollHeight - element.scrollTop - element.clientHeight < 48);
}
