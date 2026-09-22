"use client";
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {chatRequest, mergeChatMessages, atChatBottom} from '../lib/chat-client.js';
import {conferenceDate} from '../lib/conference-collaboration.js';

// Mount with key={channel.id}: an old channel's requests never update another thread.
export default function ChatThread({channel, user, drafts, onRead}) {
  const [messages, setMessages] = useState([]), [text, setText] = useState(drafts.current[channel.id] || '');
  const [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [older, setOlder] = useState(false), [historyBusy, setHistoryBusy] = useState(false), [newMessages, setNewMessages] = useState(false);
  const list = useRef(null), file = useRef(null), textarea = useRef(null), alive = useRef(false), sending = useRef(false);
  const records = useRef([]), pinned = useRef(true), scrollRestore = useRef(null), readCursor = useRef(0), readBusy = useRef(false);
  const refresh = useRef(async () => {}), readCallback = useRef(onRead);
  readCallback.current = onRead;

  async function markRead() {
    const id = Number(records.current.at(-1)?.id || 0);
    if (!alive.current || document.hidden || !atChatBottom(list.current) || readBusy.current || id <= readCursor.current) return;
    readBusy.current = true;
    try {
      await chatRequest(`/api/chat/channels/${channel.id}/read`, {method:'POST', body:JSON.stringify({message_id:id})});
      if (alive.current) { readCursor.current = id; readCallback.current?.(); }
    } catch { /* Keep unread until a later successful acknowledgement. */ }
    finally { readBusy.current = false; }
  }
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController(); let running = false, initialized = false, forbidden = false;
    async function load() {
      if (running || forbidden || document.hidden) return;
      running = true;
      try {
        const after = records.current.at(-1)?.id;
        const next = await chatRequest(`/api/chat/channels/${channel.id}/messages?mark_read=false${after ? `&after=${after}` : ''}`, {signal:controller.signal});
        if (!alive.current) return;
        const last = records.current.at(-1)?.id;
        records.current = mergeChatMessages(records.current, next);
        if (!initialized) { setOlder(next.length === 100); initialized = true; }
        if (last !== records.current.at(-1)?.id && !pinned.current) setNewMessages(true);
        setMessages(records.current); setLoaded(true); setError('');
      } catch (e) {
        if (!alive.current || e.name === 'AbortError') return;
        if ([403,404].includes(e.status)) { forbidden = true; records.current = []; setMessages([]); setLoaded(false); }
        setError(e.message);
      } finally { running = false; }
    }
    refresh.current = load;
    const visibility = () => { if (!document.hidden) { load(); markRead(); } };
    load(); const timer = setInterval(load, 4000);
    document.addEventListener('visibilitychange', visibility);
    return () => { alive.current = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [channel.id]);
  useLayoutEffect(() => {
    const element = list.current; if (!element) return;
    if (scrollRestore.current) { element.scrollTop += element.scrollHeight - scrollRestore.current.height; scrollRestore.current = null; }
    else if (pinned.current) element.scrollTop = element.scrollHeight;
    markRead();
  }, [messages]);
  useLayoutEffect(() => { if (textarea.current) { textarea.current.style.height = 'auto'; textarea.current.style.height = `${Math.min(136, Math.max(44, textarea.current.scrollHeight))}px`; } }, [text]);

  async function loadOlder() {
    if (historyBusy || !records.current.length) return;
    setHistoryBusy(true);
    try {
      const next = await chatRequest(`/api/chat/channels/${channel.id}/messages?mark_read=false&before=${records.current[0].id}`);
      if (!alive.current) return;
      pinned.current = false; scrollRestore.current = {height:list.current.scrollHeight};
      records.current = mergeChatMessages(records.current, next); setMessages(records.current); setOlder(next.length === 100);
    } catch(e) { if (alive.current) setError(e.message); }
    finally { if (alive.current) setHistoryBusy(false); }
  }
  async function send(event) {
    event.preventDefault(); if (channel.room_archived || sending.current || !text.trim() || !loaded) return;
    const sent = text; sending.current = true; setBusy(true); setError('');
    try {
      await chatRequest(`/api/chat/channels/${channel.id}/messages`, {method:'POST', body:JSON.stringify({body:sent})});
      if (drafts.current[channel.id] === sent) delete drafts.current[channel.id];
      if (alive.current) { setText(value => value === sent ? '' : value); pinned.current = true; await refresh.current(); }
    } catch(e) { if (alive.current) setError(e.message); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  async function upload(value) {
    if (channel.room_archived || !value || sending.current || !loaded) return;
    if (value.size > 25 * 1024 * 1024) { setError('Максимальный размер файла — 25 МБ'); return; }
    sending.current = true; setBusy(true); setError('');
    const details = {file_name:value.name, mime_type:value.type || 'application/octet-stream'};
    try {
      const signed = await chatRequest(`/api/chat/channels/${channel.id}/attachments/presign`, {method:'POST', body:JSON.stringify({...details,size_bytes:value.size})});
      const result = await fetch(signed.upload_url, {method:'PUT',body:value,headers:{'content-type':details.mime_type}});
      if (!result.ok) throw new Error('Не удалось загрузить файл');
      await chatRequest(`/api/chat/channels/${channel.id}/attachments/complete`, {method:'POST',body:JSON.stringify({...details,object_key:signed.object_key})});
      if (alive.current) { pinned.current = true; await refresh.current(); }
    } catch(e) { if (alive.current) setError(e.message); }
    finally { sending.current = false; if (alive.current) { setBusy(false); if(file.current) file.current.value = ''; } }
  }
  return <div className="chat-thread">
    <div className="thread-messages" ref={list} tabIndex={0} aria-label={`История чата «${channel.name}»`} onScroll={() => { pinned.current = atChatBottom(list.current); if(pinned.current) { setNewMessages(false); markRead(); } }}>
      {older && <button className="thread-history" onClick={loadOlder} disabled={historyBusy}>{historyBusy ? 'Загрузка…' : 'Предыдущие сообщения'}</button>}
      {!loaded && !error && <p className="thread-empty" role="status">Загружаем сообщения…</p>}
      {loaded && !messages.length && <div className="thread-empty"><strong>Начните разговор</strong><p>Сообщения и файлы сохранятся в этом чате.</p></div>}
      {messages.map(message => <article className={`thread-message ${Number(message.sender_id) === Number(user.id) ? 'own' : ''}`} key={message.id}>
        <div className="thread-message-meta"><strong>{message.sender_name}</strong><time>{new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(conferenceDate(message.created_at))}</time></div>
        {message.body && <p>{message.body}</p>}
        {(message.attachments || []).map(attachment => <a key={attachment.id} href={`/api/chat/attachments/${attachment.id}/download`} target="_blank" rel="noopener noreferrer">↗ {attachment.file_name} <small>· {Math.ceil(attachment.size_bytes / 1024)} КБ</small></a>)}
      </article>)}
    </div>
    {newMessages && <button className="thread-new" onClick={() => { pinned.current = true; list.current.scrollTop = list.current.scrollHeight; setNewMessages(false); markRead(); }}>Новые сообщения ↓</button>}
    {error && <p className="thread-error" role="alert">{error}</p>}
    {!channel.room_archived && <form className="thread-composer" onSubmit={send}>
      <input type="file" hidden ref={file} onChange={event => upload(event.target.files?.[0])}/>
      <button type="button" className="thread-attach" disabled={busy || !loaded} onClick={() => file.current?.click()} title="Прикрепить файл до 25 МБ" aria-label="Прикрепить файл">＋</button>
      <textarea ref={textarea} rows={1} maxLength={20000} aria-label="Текст сообщения" placeholder="Напишите сообщение…" value={text} onChange={event => { setText(event.target.value); drafts.current[channel.id] = event.target.value; }} onKeyDown={event => { if(event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }}/>
      <button className="primary thread-send" disabled={busy || !loaded || !text.trim()} aria-label={busy ? 'Отправляем…' : 'Отправить сообщение'} title="Отправить сообщение">{busy ? '…' : '↑'}</button>
    </form>}
    <small className="thread-hint">{busy ? 'Отправляем…' : 'История сохраняется · файлы до 25 МБ'}</small>
  </div>;
}
