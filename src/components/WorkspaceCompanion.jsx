"use client";
import {useEffect, useRef, useState} from 'react';
import ToolDialog from './ToolDialog.jsx';
import ChatThread from './ChatThread.jsx';
import {chatRequest} from '../lib/chat-client.js';
import {deviceMode, saveDeviceMode, enableDeviceNotifications, disableDeviceNotifications} from '../lib/browser-device.js';

function BubbleIcon() { return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2v-10a9 9 0 0 1 18 0Z"/><path d="M7 10h8M7 14h5"/></svg>; }

export default function WorkspaceCompanion({user, activeView, onOpenChat, onNotifications, installPrompt, onInstalled}) {
  const [open, setOpen] = useState(false), [settings, setSettings] = useState(false), [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState(null), [query, setQuery] = useState(''), [error, setError] = useState(''), [connectionError, setConnectionError] = useState('');
  const [mode, setMode] = useState('off'), [config, setConfig] = useState(null), [busy, setBusy] = useState(false), [installed, setInstalled] = useState(false), [viewport, setViewport] = useState({});
  const drafts = useRef({}), launcher = useRef(null), panel = useRef(null), refresh = useRef(() => {}), callbacks = useRef({onOpenChat,onNotifications});
  callbacks.current = {onOpenChat,onNotifications};
  const opened = open && activeView !== 'chat';
  const selected = channels.find(channel => Number(channel.id) === Number(channelId));
  const unread = channels.reduce((total, channel) => total + Number(channel.unread_count || 0), 0);
  const close = () => { setOpen(false); try { localStorage.setItem(`kontur-chat-open-${user.id}`, 'false'); } catch {} launcher.current?.focus(); };
  useEffect(() => {
    const resize = () => { if(window.visualViewport) setViewport({'--companion-visible-height':`${window.visualViewport.height}px`, '--companion-visible-top':`${window.visualViewport.offsetTop}px`}); };
    resize(); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize);
    return () => { window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); };
  }, []);

  useEffect(() => {
    try { setOpen(localStorage.getItem(`kontur-chat-open-${user.id}`) === 'true'); } catch {}
    const preference = deviceMode(user.id);
    if(preference !== 'off' && (!('Notification' in window) || Notification.permission !== 'granted')) { saveDeviceMode(user.id, 'off'); setMode('off'); }
    else setMode(preference);
    setInstalled(window.matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone));
    const appInstalled = () => { setInstalled(true); onInstalled?.(); };
    window.addEventListener('appinstalled', appInstalled);
    let alive = true;
    chatRequest('/api/work/push').then(async value => {
      if (!alive) return; setConfig(value);
      if (deviceMode(user.id) === 'push') {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription && Notification.permission === 'granted') { if(value.configured) await chatRequest('/api/work/push', {method:'POST',body:JSON.stringify(subscription.toJSON())}); }
        else { saveDeviceMode(user.id, 'off'); if(alive) setMode('off'); }
      }
    }).catch(() => { if(alive) setError('Не удалось проверить настройки уведомлений. Повторите подключение.'); });
    return () => { alive = false; window.removeEventListener('appinstalled', appInstalled); };
  }, [user.id]);
  useEffect(() => {
    document.body.classList.toggle('companion-expanded', opened);
    return () => document.body.classList.remove('companion-expanded');
  }, [opened]);
  useEffect(() => { if (opened) panel.current?.focus(); }, [opened]);
  useEffect(() => {
    let alive = true, running = false, previous = null;
    const controller = new AbortController();
    async function poll() {
      if(running) return; running = true;
      try {
        const [next, notifications] = await Promise.all([chatRequest('/api/chat/channels', {signal:controller.signal}), chatRequest('/api/notifications', {signal:controller.signal})]);
        if(!alive) return;
        setChannels(next); setConnectionError(''); callbacks.current.onNotifications(notifications);
        const total = next.reduce((n,c) => n + Number(c.unread_count || 0), 0) + notifications.filter(n => !n.read_at).length;
        if(total) navigator.setAppBadge?.(total)?.catch(() => {}); else navigator.clearAppBadge?.()?.catch(() => {});
        const snapshot = new Map(next.map(c => [Number(c.id), Number(c.unread_count || 0)]));
        const lastNotice = Math.max(0, ...notifications.filter(n => !n.read_at).map(n => Number(n.id)));
        const newChat = previous && next.find(c => Number(c.unread_count) > (previous.channels.get(Number(c.id)) || 0));
        if(previous && document.hidden && deviceMode(user.id) === 'local' && 'Notification' in window && Notification.permission === 'granted' && (newChat || lastNotice > previous.notice)) {
          const registration = await navigator.serviceWorker.getRegistration();
          await registration?.showNotification('Контур', {body:'Есть новые сообщения или уведомления',icon:'/icons/kontur-192.png',tag:`kontur-${user.id}`,data:{url:newChat ? `/?view=chat&channel=${newChat.id}` : '/?notifications=1'}});
        }
        previous = {channels:snapshot,notice:lastNotice};
      } catch(e) { if(alive && e.name !== 'AbortError') setConnectionError('Нет связи с сервером. Переподключаемся…'); }
      finally { running = false; }
    }
    async function presence() { if(document.hidden) return; try { await chatRequest('/api/chat/presence', {method:'POST',body:JSON.stringify({state:'online'}),signal:controller.signal}); } catch {} }
    refresh.current = poll;
    const visible = () => { if(!document.hidden) { poll(); presence(); } };
    poll(); presence(); const timer = setInterval(() => { poll(); presence(); }, 15000);
    document.addEventListener('visibilitychange', visible);
    return () => { alive = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [user.id]);

  function toggle() {
    if(activeView === 'chat') { setSettings(true); return; }
    const next = !open; setOpen(next);
    try { localStorage.setItem(`kontur-chat-open-${user.id}`, String(next)); } catch {}
  }
  async function configure(enable) {
    setBusy(true); setError('');
    try {
      if(enable) setMode(await enableDeviceNotifications(config || {configured:false}, user.id));
      else { await disableDeviceNotifications(user.id); setMode('off'); }
    } catch(e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <>
    <aside className="companion-rail" aria-label="Быстрый доступ к чату">
      <button ref={launcher} className={`companion-launcher ${opened ? 'active' : ''}`} onClick={toggle} aria-label={activeView === 'chat' ? 'Настройки приложения и уведомлений' : `Чат: ${unread} непрочитанных`} aria-expanded={opened} aria-controls="workspace-chat">{activeView === 'chat' ? '⚙' : <BubbleIcon/>}{unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}<span>{activeView === 'chat' ? 'Опции' : 'Чат'}</span></button>
      <button className="companion-settings" onClick={() => setSettings(true)} title="Приложение и уведомления" aria-label="Приложение и уведомления">⚙</button>
    </aside>
    {opened && <aside className="companion-panel" style={viewport} id="workspace-chat" ref={panel} tabIndex={-1} aria-label="Панель чата" onKeyDown={event => { if(event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <header className="companion-head"><div><span className="overline">НА СВЯЗИ</span><h2>Чат команды</h2></div><div><button onClick={() => setSettings(true)} title="Уведомления" aria-label="Настроить уведомления">⚙</button><button onClick={close} title="Свернуть чат" aria-label="Свернуть чат">×</button></div></header>
      {connectionError && <p className="thread-error" role="status">{connectionError}</p>}
      {selected ? <><div className="companion-channel-head"><button onClick={() => setChannelId(null)} aria-label="Все чаты">←</button><div><strong>{selected.name}</strong><small>{selected.project_name || 'Рабочая группа'}</small></div><button onClick={() => callbacks.current.onOpenChat(selected.id)} aria-label="Открыть полный чат" title="Открыть полный чат">↗</button></div><ChatThread key={selected.id} channel={selected} user={user} drafts={drafts} onRead={() => refresh.current()}/></> : <>
        <label className="companion-search"><span>Найти чат</span><input type="search" placeholder="Название или проект" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <div className="companion-channels">{channels.filter(c => `${c.name} ${c.project_name || ''}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))).map(channel => <button key={channel.id} onClick={() => setChannelId(channel.id)}><span className="companion-avatar">{channel.channel_type === 'project' ? '#' : String(channel.name).slice(0,1).toUpperCase()}</span><span><strong>{channel.name}</strong><small>{channel.project_name || (channel.channel_type === 'direct' ? 'Личный чат' : 'Групповой чат')}</small></span>{Number(channel.unread_count) > 0 && <b>{Number(channel.unread_count) > 99 ? '99+' : channel.unread_count}</b>}</button>)}{!channels.length && <p className="thread-empty">Ваши чаты появятся здесь. Создайте первый в разделе «Чат и встречи».</p>}{channels.length > 0 && !channels.some(c => `${c.name} ${c.project_name || ''}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))) && <p className="thread-empty">Чат не найден</p>}</div>
        <footer className="companion-footer"><button className="secondary" onClick={() => callbacks.current.onOpenChat(null)}>Все чаты и встречи ↗</button><button className="text-button" onClick={() => setSettings(true)}>{mode === 'off' ? 'Включить уведомления' : 'Приложение и уведомления'}</button></footer>
      </>}
    </aside>}
    {settings && <ToolDialog title="Контур на вашем устройстве" subtitle="Приложение и уведомления настраиваются для этого браузера." onClose={() => !busy && setSettings(false)}>
      <div className="device-settings"><section><span className="overline">ПРИЛОЖЕНИЕ</span><h3>{installed ? 'Контур уже установлен' : 'Работайте в отдельном окне'}</h3><p>Быстрый запуск с рабочего стола или экрана телефона.</p>{!installed && (installPrompt ? <button className="primary" onClick={async () => { try { await installPrompt.prompt(); await installPrompt.userChoice; onInstalled?.(); } catch(e) { setError(e.message); } }}>Установить Контур</button> : <p className="device-hint">В меню браузера выберите «Установить приложение». На iPhone и iPad: Safari → «Поделиться» → «На экран Домой».</p>)}</section>
      <section><span className="overline">УВЕДОМЛЕНИЯ</span><h3>{mode === 'push' ? (config?.configured ? 'Фоновые уведомления включены' : 'Подписка сохранена, сервер пока не готов') : mode === 'local' ? 'Уведомления при открытом приложении' : 'Не пропускайте сообщения'}</h3><p>На экране блокировки показываем только уведомление о новых событиях, без текста переписки.</p>{!config ? <p>Проверяем подключение к серверу…</p> : config.configured ? <p>Фоновые уведомления работают и после закрытия вкладки, если их разрешают браузер и устройство.</p> : <p className="device-hint">Серверные push-уведомления ещё не подключены. Пока уведомления работают при открытой вкладке; в фоне браузер может задерживать проверку.</p>}
      {mode === 'off' ? <button className="primary" disabled={busy || !config} onClick={() => configure(true)}>{busy ? 'Подключаем…' : 'Включить уведомления'}</button> : <div className="connector-actions">{mode === 'local' && config?.configured && <button className="primary" disabled={busy} onClick={() => configure(true)}>Включить фоновые</button>}<button className="secondary" disabled={busy} onClick={() => configure(false)}>Отключить на устройстве</button></div>}
      {!config && <button className="text-button" disabled={busy} onClick={() => { setError(''); chatRequest('/api/work/push').then(setConfig).catch(e => setError(e.message)); }}>Проверить подключение</button>}</section>
      {error && <p className="thread-error" role="alert">{error}</p>}</div>
    </ToolDialog>}
  </>;
}
