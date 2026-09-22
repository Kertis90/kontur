import {chatRequest} from './chat-client.js';
export const devicePreference = userId => `kontur-device-notifications-${userId}`;
export function deviceMode(userId) { try { return localStorage.getItem(devicePreference(userId)) || 'off'; } catch { return 'off'; } }
export function saveDeviceMode(userId, mode) { try { localStorage.setItem(devicePreference(userId), mode); } catch {} }
export async function workerRegistration() {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) throw new Error('Нужен HTTPS и браузер с поддержкой PWA');
  await navigator.serviceWorker.register('/sw.js');
  let timer;
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Приложение ещё обновляется. Повторите через несколько секунд.')), 10000); })]); }
  finally { clearTimeout(timer); }
}
export function publicKeyBytes(value) {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
export async function enableDeviceNotifications(config, userId) {
  if (!window.isSecureContext || !('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('Уведомления недоступны. На iPhone сначала добавьте Контур на экран «Домой».');
  // Called directly by a click, before awaiting any network request (Safari user activation).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Уведомления не разрешены. Изменить разрешение можно в настройках сайта браузера.');
  const registration = await workerRegistration();
  if (config.configured && 'PushManager' in window) {
    const existing = await registration.pushManager.getSubscription();
    const requested = publicKeyBytes(config.public_key);
    let subscription = existing;
    if (existing && existing.options.applicationServerKey && !new Uint8Array(existing.options.applicationServerKey).every((byte, i) => byte === requested[i])) { await existing.unsubscribe(); subscription = null; }
    subscription ||= await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:requested});
    await chatRequest('/api/work/push', {method:'POST',body:JSON.stringify(subscription.toJSON())});
    saveDeviceMode(userId, 'push'); return 'push';
  }
  saveDeviceMode(userId, 'local'); return 'local';
}
export async function disableDeviceNotifications(userId) {
  const registration = await navigator.serviceWorker?.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) {
    await chatRequest('/api/work/push', {method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint})});
    await subscription.unsubscribe();
  }
  saveDeviceMode(userId, 'off');
  for (const notification of await registration?.getNotifications() || []) notification.close();
}
export async function clearDeviceOnLogout() {
  const registration = await navigator.serviceWorker?.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  await subscription?.unsubscribe();
  for (const notification of await registration?.getNotifications() || []) notification.close();
  await navigator.clearAppBadge?.();
}
