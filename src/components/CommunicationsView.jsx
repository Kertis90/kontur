"use client";
import ChatRooms from "./ChatRooms.jsx";
import ChatThread from "./ChatThread.jsx";
import ConferenceCaptions from "./ConferenceCaptions.jsx";
import ConferenceTools from "./ConferenceTools.jsx";

import { useEffect, useRef, useState } from "react";
import ConferenceRecordings from "./ConferenceRecordings.jsx";
import { AiButton } from "./AiTools";
import { Room, RoomEvent, Track, VideoPresets } from "livekit-client";
import {
  conferenceDate,
  mergeConferenceMessages,
} from "../lib/conference-collaboration.js";

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Ошибка запроса");
  return body;
}

function formatDate(value, time = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(
    "ru-RU",
    time
      ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
      : { dateStyle: "medium" },
  ).format(conferenceDate(value));
}

function localInput(offsetMinutes = 30) {
  const value = new Date(Date.now() + offsetMinutes * 60000);
  value.setSeconds(0, 0);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function Avatar({ user, online = false }) {
  return (
    <span
      className={`comm-avatar ${online ? "online" : ""}`}
      style={{ background: user.avatar_color || "#675ee7" }}
    >
      {String(user.display_name || "?")
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")}
    </span>
  );
}

// Показывает переписку в пределах окна и сохраняет переключение комнат и встреч.
export default function CommunicationsView({ data, project, notify, initialChannelId }) {
  const [section, setSection] = useState("chat");
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState(initialChannelId || null);
  const chatDrafts = useRef({});
  const [presence, setPresence] = useState([]);
  const [conferences, setConferences] = useState([]);
  const [includeHistory, setIncludeHistory] = useState(false);
  const includeHistoryRef = useRef(false);
  const [chatDraft, setChatDraft] = useState(null);
  const [conferenceDraft, setConferenceDraft] = useState(null);
  const [peoplePicker, setPeoplePicker] = useState(null);
  const [meeting, setMeeting] = useState(null);
  const [startingNow, setStartingNow] = useState(false);


  async function refresh() {
    try {
      const [nextChannels, nextPresence, nextConferences] = await Promise.all([
        request("/api/chat/channels"),
        request("/api/chat/presence"),
        request(`/api/conferences${includeHistoryRef.current ? "?history=true" : ""}`),
      ]);
      setChannels(nextChannels);
      setPresence(nextPresence);
      setConferences(nextConferences);
      setChannelId((current) =>
        current && nextChannels.some((item) => item.id === current)
          ? current
          : nextChannels[0]?.id || null,
      );
      return nextConferences;
    } catch (error) {
      notify(error.message, "error");
    }
  }
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const joinCode = new URLSearchParams(window.location.search).get(
      "conference",
    );
    if (!joinCode) return;
    setSection("meetings");
    request(`/api/conferences/join/${encodeURIComponent(joinCode)}`)
      .then((conference) => setMeeting({ conference, phase: ["completed", "cancelled"].includes(conference.status) ? "history" : "setup" }))
      .catch((error) => notify(error.message, "error"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (initialChannelId) { setChannelId(initialChannelId); setSection("chat"); } }, [initialChannelId]);

  async function createChat(event) {
    event.preventDefault();
    try {
      const payload = {
        ...chatDraft,
        project_id:
          chatDraft.channel_type === "project"
            ? chatDraft.project_id || project?.id
            : null,
        member_ids: chatDraft.member_ids.map(Number),
      };
      const result = await request("/api/chat/channels", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setChatDraft(null);
      await refresh();
      setChannelId(result.id);
      notify("Чат создан");
    } catch (error) {
      notify(error.message, "error");
    }
  }
  async function schedule(event) {
    event.preventDefault();
    try {
      await request("/api/conferences", {
        method: "POST",
        body: JSON.stringify({
          ...conferenceDraft,
          scheduled_start: new Date(
            conferenceDraft.scheduled_start,
          ).toISOString(),
          scheduled_end: new Date(conferenceDraft.scheduled_end).toISOString(),
          participant_ids: conferenceDraft.participant_ids.map(Number),
          presenter_ids: conferenceDraft.presenter_ids.map(Number),
        }),
      });
      setConferenceDraft(null);
      await refresh();
      notify("Конференция запланирована");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function startNow() {
    if (!project || startingNow) return;
    setStartingNow(true);
    const start = new Date();
    const end = new Date(start.getTime() + 12 * 60 * 60 * 1000);
    try {
      const conference = await request("/api/conferences", {
        method: "POST",
        body: JSON.stringify({
          project_id: project.id,
          title: `Быстрая встреча · ${start.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}`,
          description: "Конференция запущена без предварительного планирования",
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          conference_mode: "interactive",
          max_publishers: 150,
          participant_ids: [],
          presenter_ids: [],
          start_now: true,
        }),
      });
      setConferences((current) => [
        conference,
        ...current.filter((item) => item.id !== conference.id),
      ]);
      setMeeting({ conference, phase: "setup" });
      notify("Конференция создана — можно входить и делиться ссылкой");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setStartingNow(false);
    }
  }

  function conferenceLink(conference) {
    return `${window.location.origin}/?conference=${conference.join_code}`;
  }

  async function copyConferenceLink(conference) {
    try {
      await navigator.clipboard.writeText(conferenceLink(conference));
      notify("Ссылка на конференцию скопирована");
    } catch {
      notify("Не удалось скопировать ссылку", "error");
    }
  }

  const current = channels.find((item) => item.id === channelId);
  const projectPermissions =
    data.permissions.projects[String(project?.id)] || {};
  const canCreateConference = projectPermissions["conference.create"];
  return (
    <div className={`view-page communications-page communications-${section}`}>
      <div className="page-head">
        <div>
          <h1>Чат и встречи</h1>
        </div>
        <div className="head-actions">
          <button
            className={section === "chat" ? "primary" : "secondary"}
            onClick={() => setSection("chat")}
          >
            Чаты
          </button>
          <button className={section === "rooms" ? "primary" : "secondary"} onClick={() => setSection("rooms")}>Комнаты</button>
          <button
            className={section === "meetings" ? "primary" : "secondary"}
            onClick={() => setSection("meetings")}
          >
            Конференции
          </button>
        </div>
      </div>
      {section === "rooms" ? <ChatRooms data={data} notify={notify} onChanged={refresh} onOpen={async id=>{await refresh();setChannelId(id);setSection("chat");}}/> : section === "chat" ? (
        <div className="chat-layout">
          <aside className="surface chat-sidebar">
            <div className="chat-side-head">
              <strong>Сообщения</strong>
              <button
                type="button"
                onClick={() =>
                  setChatDraft({
                    channel_type: "group",
                    project_id: project?.id || null,
                    name: "",
                    member_ids: [],
                  })
                }
                aria-label="Создать чат"
                title="Создать чат"
              >
                +
              </button>
            </div>
            <button className="room-discover" onClick={()=>setSection("rooms")}><span aria-hidden="true">⌕</span><span>Найти комнату</span><span aria-hidden="true">↗</span></button>
            {channels.map((channel) => (
              <button
                className={channel.id === channelId ? "active" : ""}
                key={channel.id}
                onClick={() => setChannelId(channel.id)}
              >
                <span className="channel-glyph">
                  {channel.room_id || channel.channel_type === "project" ? "#" : "@"}
                </span>
                <span>
                  <strong>{channel.name}</strong>
                  <small>
                    {channel.room_id ? "Комната" : channel.project_name ||
                      (channel.channel_type === "direct"
                        ? "Личный чат"
                        : "Групповой чат")}
                  </small>
                </span>
                {Number(channel.unread_count) > 0 && (
                  <b>{channel.unread_count}</b>
                )}
              </button>
            ))}
            <div className="online-list">
              <strong>Сотрудники</strong>
              {presence.map((user) => (
                <div key={user.id}>
                  <Avatar user={user} online={user.state === "online"} />
                  <span>
                    <strong>{user.display_name}</strong>
                    <small>
                      {user.state === "online"
                        ? "в сети"
                        : user.state === "away"
                          ? "отошёл"
                          : `был ${formatDate(user.last_seen_at, true)}`}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          </aside>
          <section className="surface chat-main">
            {current ? (
              <>
                <header>
                  <div>
                    <span className="channel-glyph">#</span>
                    <span>
                      <strong>{current.name}</strong>
                      <small>
                        {current.project_name || "Рабочее пространство"}
                      </small>
                    </span>
                  </div>
                </header>
                {current.room_id && <div className="room-thread-bar"><span>{current.room_archived ? 'Архив комнаты · история доступна' : 'Постоянная комната · история сохраняется'}</span><button className="secondary" onClick={()=>setSection("rooms")}>Все комнаты</button><button className="secondary" onClick={async()=>{try{await request(`/api/chat/rooms/${current.id}/leave`,{method:'POST'});await refresh();setSection('rooms');notify('Вы вышли из комнаты');}catch(e){notify(e.message,'error');}}}>Выйти</button></div>}
                <ChatThread key={current.id} channel={current} user={data.user} drafts={chatDrafts} onRead={refresh}/>
              </>
            ) : (
              <div className="comm-empty">
                Создайте чат или выберите существующий
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="meeting-page">
          <div className="meeting-actions">
            <button className="secondary meeting-history-toggle" aria-pressed={includeHistory}
              onClick={() => {
                includeHistoryRef.current = !includeHistory;
                setIncludeHistory(!includeHistory);
                refresh();
              }}>
              {includeHistory ? "Показать недавние встречи" : "Все встречи и история"}
            </button>
            {canCreateConference && (
              <>
                <button
                  className="primary meeting-now"
                  onClick={startNow}
                  disabled={startingNow}
                >
                  {startingNow ? "Создаём…" : "▶ Начать сейчас"}
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    setConferenceDraft({
                      project_id: project.id,
                      title: "",
                      description: "",
                      scheduled_start: localInput(30),
                      scheduled_end: localInput(90),
                      conference_mode: "interactive",
                      max_publishers: 25,
                      participant_ids: [],
                      presenter_ids: [],
                    })
                  }
                >
                  + Запланировать
                </button>
              </>
            )}
          </div>
          <div className="conference-grid">
            {conferences.map((conference) => (
              <article className="surface conference-card" key={conference.id}>
                <span className={`status-pill ${conference.status}`}>
                  {conference.status === "live"
                    ? "ИДЁТ СЕЙЧАС"
                    : conference.status === "scheduled"
                      ? "ЗАПЛАНИРОВАНА"
                      : conference.status === "cancelled" ? "ОТМЕНЕНА" : "ЗАВЕРШЕНА"}
                </span>
                <span className="conference-mode">
                  {conference.conference_mode === "webinar"
                    ? "Вебинар · без лимита зрителей"
                    : "Интерактивная встреча"}
                </span>
                <h2>{conference.title}</h2>
                <p>{conference.description || conference.project_name}</p>
                <div>
                  <span>
                    <strong>
                      {formatDate(conference.scheduled_start, true)}
                    </strong>
                    <small>
                      до {formatDate(conference.scheduled_end, true)}
                    </small>
                  </span>
                  <span>
                    <strong>
                      {conference.join_policy === "link"
                        ? "По ссылке"
                        : Math.max(0, Number(conference.participant_count) - 1)}
                    </strong>
                    <small>
                      {conference.join_policy === "link"
                        ? "свободное подключение"
                        : "приглашено"}
                    </small>
                  </span>
                </div>
                <div className="conference-card-actions">
                  <button
                    className="secondary conference-copy"
                    onClick={() => copyConferenceLink(conference)}
                    title="Скопировать ссылку для подключения"
                  >
                    Скопировать ссылку
                  </button>
                  <button
                    className="primary"
                    onClick={() => setMeeting({ conference, phase: "setup" })}
                    disabled={["completed", "cancelled"].includes(conference.status)}
                  >
                    {conference.conference_mode === "webinar" &&
                    conference.current_user_role === "participant"
                      ? "Войти как зритель"
                      : "Войти"}
                  </button>
                  <ConferenceRecordings conference={conference}/><AiButton kind="conference" sourceId={conference.id} title={conference.title} joinCode={conference.join_code} permissions={data.permissions.projects[String(conference.project_id)]}/>
                  <button className="secondary conference-history" onClick={() => setMeeting({ conference, phase: "history" })}>
                    История чата и вопросов
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {chatDraft && (
        <div className="comm-modal">
          <form className="surface" onSubmit={createChat}>
            <h2>Новый чат</h2>
            <label>
              <span>Тип</span>
              <select
                value={chatDraft.channel_type}
                onChange={(event) =>
                  setChatDraft({
                    ...chatDraft,
                    channel_type: event.target.value,
                  })
                }
              >
                <option value="group">Групповой</option>
                <option value="direct">Личный</option>
                <option value="project">Канал проекта</option>
              </select>
            </label>
            <label>
              <span>Название</span>
              <input
                value={chatDraft.name}
                onChange={(event) =>
                  setChatDraft({ ...chatDraft, name: event.target.value })
                }
                placeholder="Команда запуска"
              />
            </label>
            <label>
              <span>Проект</span>
              <select
                value={chatDraft.project_id || ""}
                onChange={(event) =>
                  setChatDraft({
                    ...chatDraft,
                    project_id: event.target.value
                      ? Number(event.target.value)
                      : null,
                  })
                }
              >
                <option value="">Без проекта</option>
                {data.projects
                  .filter(
                    (item) =>
                      data.permissions.projects[String(item.id)]?.["chat.use"],
                  )
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Участники</span>
              <select
                multiple
                value={chatDraft.member_ids.map(String)}
                onChange={(event) =>
                  setChatDraft({
                    ...chatDraft,
                    member_ids: [...event.target.selectedOptions].map(
                      (option) => option.value,
                    ),
                  })
                }
              >
                {data.users
                  .filter((user) => user.id !== data.user.id)
                  .map((user) => (
                    <option value={user.id} key={user.id}>
                      {user.display_name}
                    </option>
                  ))}
              </select>
            </label>
            <div>
              <button
                type="button"
                className="secondary"
                onClick={() => setChatDraft(null)}
              >
                Отмена
              </button>
              <button className="primary">Создать</button>
            </div>
          </form>
        </div>
      )}
      {conferenceDraft && (
        <div className="comm-modal">
          <form className="surface conference-form" onSubmit={schedule}>
            <h2>Новая конференция</h2>
            <label>
              <span>Название</span>
              <input
                value={conferenceDraft.title}
                onChange={(event) =>
                  setConferenceDraft({
                    ...conferenceDraft,
                    title: event.target.value,
                  })
                }
                required
              />
            </label>
            <label>
              <span>Проект</span>
              <select
                value={conferenceDraft.project_id}
                onChange={(event) =>
                  setConferenceDraft({
                    ...conferenceDraft,
                    project_id: Number(event.target.value),
                  })
                }
              >
                {data.projects
                  .filter(
                    (item) =>
                      data.permissions.projects[String(item.id)]?.[
                        "conference.create"
                      ],
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Формат</span>
              <select
                value={conferenceDraft.conference_mode}
                onChange={(event) => {
                  const webinar = event.target.value === "webinar";
                  setConferenceDraft({
                    ...conferenceDraft,
                    conference_mode: event.target.value,
                    max_publishers: webinar ? 25 : 150,
                  });
                }}
              >
                <option value="interactive">Интерактивная встреча</option>
                <option value="webinar">Вебинар для большой аудитории</option>
              </select>
            </label>
            <label>
              <span>Начало</span>
              <input
                type="datetime-local"
                value={conferenceDraft.scheduled_start}
                onChange={(event) =>
                  setConferenceDraft({
                    ...conferenceDraft,
                    scheduled_start: event.target.value,
                  })
                }
                required
              />
            </label>
            <label>
              <span>Окончание</span>
              <input
                type="datetime-local"
                value={conferenceDraft.scheduled_end}
                onChange={(event) =>
                  setConferenceDraft({
                    ...conferenceDraft,
                    scheduled_end: event.target.value,
                  })
                }
                required
              />
            </label>
            <label className="wide-field">
              <span>Описание</span>
              <textarea
                value={conferenceDraft.description}
                onChange={(event) =>
                  setConferenceDraft({
                    ...conferenceDraft,
                    description: event.target.value,
                  })
                }
              />
            </label>
            <div className="wide-field conference-people-field">
              <span>Приглашённые</span>
              <div className="conference-people-summary">
                <div>
                  {conferenceDraft.participant_ids.length ? (
                    conferenceDraft.participant_ids.map((userId) => {
                      const account = data.users.find(
                        (user) => Number(user.id) === Number(userId),
                      );
                      return account ? (
                        <span className="person-chip" key={userId}>
                          <Avatar user={account} />
                          {account.display_name}
                          <button
                            type="button"
                            onClick={() =>
                              setConferenceDraft({
                                ...conferenceDraft,
                                participant_ids:
                                  conferenceDraft.participant_ids.filter(
                                    (idValue) =>
                                      Number(idValue) !== Number(userId),
                                  ),
                                presenter_ids:
                                  conferenceDraft.presenter_ids.filter(
                                    (idValue) =>
                                      Number(idValue) !== Number(userId),
                                  ),
                              })
                            }
                            aria-label={`Убрать ${account.display_name}`}
                          >
                            ×
                          </button>
                        </span>
                      ) : null;
                    })
                  ) : (
                    <small>
                      Никто не выбран — коллеги смогут подключиться по
                      сформированной ссылке.
                    </small>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setPeoplePicker({
                      kind: "participants",
                      title: "Выбрать участников",
                      selected: conferenceDraft.participant_ids,
                    })
                  }
                >
                  Выбрать людей
                </button>
              </div>
            </div>
            {conferenceDraft.conference_mode === "webinar" && (
              <div className="wide-field conference-people-field">
                <span>Докладчики</span>
                <div className="conference-people-summary">
                  <small>
                    {conferenceDraft.presenter_ids.length
                      ? `${conferenceDraft.presenter_ids.length} выбрано — им доступны камера, микрофон и демонстрация экрана.`
                      : "Организатор остаётся единственным докладчиком."}
                  </small>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setPeoplePicker({
                        kind: "presenters",
                        title: "Выбрать докладчиков",
                        selected: conferenceDraft.presenter_ids,
                      })
                    }
                  >
                    Выбрать докладчиков
                  </button>
                </div>
              </div>
            )}
            <label className="wide-field work-checkbox"><input type="checkbox" checked={Boolean(conferenceDraft.waiting_room)} onChange={event=>setConferenceDraft({...conferenceDraft,waiting_room:event.target.checked})}/>Зал ожидания: организатор допускает участников</label>
            <div className="wide-field">
              <button
                type="button"
                className="secondary"
                onClick={() => setConferenceDraft(null)}
              >
                Отмена
              </button>
              <button className="primary">Запланировать</button>
            </div>
          </form>
        </div>
      )}
      {peoplePicker && conferenceDraft && (
        <PeoplePicker
          users={data.users.filter((user) => user.id !== data.user.id)}
          title={peoplePicker.title}
          initial={peoplePicker.selected}
          onClose={() => setPeoplePicker(null)}
          onApply={(selectedIds) => {
            if (peoplePicker.kind === "presenters")
              setConferenceDraft({
                ...conferenceDraft,
                presenter_ids: selectedIds,
                participant_ids: [
                  ...new Set([
                    ...conferenceDraft.participant_ids.map(Number),
                    ...selectedIds.map(Number),
                  ]),
                ],
              });
            else
              setConferenceDraft({
                ...conferenceDraft,
                participant_ids: selectedIds,
                presenter_ids: conferenceDraft.presenter_ids.filter((userId) =>
                  selectedIds.some(
                    (selectedId) => Number(selectedId) === Number(userId),
                  ),
                ),
              });
            setPeoplePicker(null);
          }}
        />
      )}
      {meeting?.phase === "setup" && (
        <DeviceSetup
          conference={meeting.conference}
          onClose={() => setMeeting(null)}
          onJoin={(settings) =>
            setMeeting({
              conference: meeting.conference,
              phase: "room",
              settings,
            })
          }
          notify={notify}
        />
      )}{" "}
      {["room", "history"].includes(meeting?.phase) && (
        <MeetingRoom
          key={`${meeting.conference.id}-${meeting.phase}`}
          conference={meeting.conference}
          settings={meeting.settings}
          historyOnly={meeting.phase === "history"}
          onClose={() => setMeeting(null)}
          notify={notify}
        />
      )}{" "}
    </div>
  );
}

function PeoplePicker({ users, title, initial, onApply, onClose }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => initial.map(Number));
  const normalized = query.trim().toLowerCase();
  const visible = users.filter((user) =>
    `${user.display_name} ${user.email || ""}`.toLowerCase().includes(normalized),
  );
  function toggle(userId) {
    setSelected((current) =>
      current.includes(Number(userId))
        ? current.filter((idValue) => idValue !== Number(userId))
        : [...current, Number(userId)],
    );
  }
  return (
    <div className="comm-modal people-picker-modal">
      <section className="surface people-picker" role="dialog" aria-modal="true">
        <header>
          <div>
            <span className="overline">УЧАСТНИКИ</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            Закрыть
          </button>
        </header>
        <label className="people-search">
          <span>Поиск по имени или почте</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Начните вводить имя…"
          />
        </label>
        <div className="people-picker-list">
          {visible.map((user) => (
            <label key={user.id} className={selected.includes(Number(user.id)) ? "selected" : ""}>
              <input
                type="checkbox"
                checked={selected.includes(Number(user.id))}
                onChange={() => toggle(user.id)}
              />
              <Avatar user={user} />
              <span>
                <strong>{user.display_name}</strong>
                <small>{user.email || "Сотрудник рабочего пространства"}</small>
              </span>
            </label>
          ))}
          {!visible.length && <div className="comm-empty">Никого не найдено</div>}
        </div>
        <footer>
          <span>Выбрано: {selected.length}</span>
          <div>
            <button type="button" className="secondary" onClick={onClose}>
              Отмена
            </button>
            <button type="button" className="primary" onClick={() => onApply(selected)}>
              Применить
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function PreviewVideo({ stream }) {
  return (
    <video
      autoPlay
      playsInline
      muted
      ref={(node) => {
        if (node && node.srcObject !== stream) node.srcObject = stream;
      }}
    />
  );
}

function DeviceSetup({ conference, onClose, onJoin, notify }) {
  const canPublish =
    conference.conference_mode === "interactive" ||
    ["host", "presenter"].includes(conference.current_user_role);
  const [stream, setStream] = useState(null);
  const previewRef = useRef(null);
  const [devices, setDevices] = useState([]);
  const [audioId, setAudioId] = useState("");
  const [videoId, setVideoId] = useState("");
  const [audio, setAudio] = useState(canPublish);
  const [video, setVideo] = useState(canPublish);

  function stopPreview() {
    previewRef.current?.getTracks().forEach((track) => track.stop());
    previewRef.current = null;
  }

  async function prepare() {
    if (!canPublish) return;
    try {
      stopPreview();
      if (!audio && !video) {
        setStream(null);
        setDevices(await navigator.mediaDevices.enumerateDevices());
        return;
      }
      const next = await navigator.mediaDevices.getUserMedia({
        audio: audio
          ? { deviceId: audioId ? { exact: audioId } : undefined }
          : false,
        video: video
          ? { deviceId: videoId ? { exact: videoId } : undefined }
          : false,
      });
      previewRef.current = next;
      setStream(next);
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (error) {
      setStream(null);
      notify(`Не удалось открыть устройства: ${error.message}`, "error");
    }
  }

  useEffect(() => {
    prepare();
    return stopPreview;
  }, [audio, video, audioId, videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  function join() {
    stopPreview();
    onJoin({
      audio: canPublish && audio,
      video: canPublish && video,
      audioId,
      videoId,
    });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/?conference=${conference.join_code}`,
      );
      notify("Ссылка на конференцию скопирована");
    } catch {
      notify("Не удалось скопировать ссылку", "error");
    }
  }

  return (
    <div className="meeting-overlay">
      <div className="device-setup">
        <div className="device-preview">
          {canPublish && stream?.getVideoTracks().length ? (
            <PreviewVideo stream={stream} />
          ) : (
            <span>{canPublish ? "Камера выключена" : "Режим зрителя"}</span>
          )}
        </div>
        <div className="device-panel">
          <span className="overline">
            {canPublish ? "ПРОВЕРКА ОБОРУДОВАНИЯ" : "ВХОД В ВЕБИНАР"}
          </span>
          <h2>{conference.title}</h2>
          <p>
            {canPublish
              ? "Проверьте камеру и микрофон. После входа можно демонстрировать экран."
              : "Вы подключитесь как зритель. Камера и микрофон не запрашиваются."}
          </p>
          {canPublish && (
            <>
              <label>
                <span>Микрофон</span>
                <select
                  value={audioId}
                  onChange={(event) => setAudioId(event.target.value)}
                >
                  <option value="">Системный по умолчанию</option>
                  {devices
                    .filter((item) => item.kind === "audioinput")
                    .map((item) => (
                      <option key={item.deviceId} value={item.deviceId}>
                        {item.label || "Микрофон"}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Камера</span>
                <select
                  value={videoId}
                  onChange={(event) => setVideoId(event.target.value)}
                >
                  <option value="">Системная по умолчанию</option>
                  {devices
                    .filter((item) => item.kind === "videoinput")
                    .map((item) => (
                      <option key={item.deviceId} value={item.deviceId}>
                        {item.label || "Камера"}
                      </option>
                    ))}
                </select>
              </label>
              <div className="device-toggles">
                <button
                  type="button"
                  className={audio ? "active" : ""}
                  onClick={() => setAudio(!audio)}
                >
                  🎙 {audio ? "Микрофон включён" : "Микрофон выключен"}
                </button>
                <button
                  type="button"
                  className={video ? "active" : ""}
                  onClick={() => setVideo(!video)}
                >
                  📹 {video ? "Камера включена" : "Камера выключена"}
                </button>
              </div>
            </>
          )}
          <div className="device-share-link">
            <span>
              <strong>Ссылка для подключения</strong>
              <small>
                {conference.join_policy === "link"
                  ? "Подключиться сможет любой авторизованный сотрудник со ссылкой."
                  : "Подключиться смогут выбранные приглашённые."}
              </small>
            </span>
            <button type="button" onClick={copyLink}>
              Копировать
            </button>
          </div>
          <div className="device-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                stopPreview();
                onClose();
              }}
            >
              Отмена
            </button>
            <button type="button" className="primary" onClick={join}>
              Войти в конференцию
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveKitTrack({ item }) {
  const mediaRef = useRef(null);
  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return undefined;
    item.track.attach(element);
    return () => item.track.detach(element);
  }, [item.track]);
  if (item.track.kind === Track.Kind.Audio)
    return <audio ref={mediaRef} autoPlay />;
  return <video ref={mediaRef} autoPlay playsInline muted={item.local} />;
}

function MeetingRoom({ conference, settings = {}, historyOnly = false, onClose, notify }) {
  const [breakoutId,setBreakoutId]=useState(null),[waiting,setWaiting]=useState(false),joinSettingsRef=useRef(settings);
  const [liveRecording, setLiveRecording] = useState(undefined);
  const [ending,setEnding]=useState(false);
  const roomRef = useRef(null);
  const messagesAfterRef = useRef(null);
  const messageRequestRef = useRef(null);
  const sendingRef = useRef(false);
  const refreshRoomRef = useRef(() => {});
  const scrollToBottomRef = useRef(true);
  const meetingDialogRef = useRef(null);
  const chatScrollRef = useRef(null);
  const composerRef = useRef(null);
  const [media, setMedia] = useState([]);
  const [participantCount, setParticipantCount] = useState(1);
  const [connectedUserIds, setConnectedUserIds] = useState([]);
  const [connection, setConnection] = useState("Подключение…");
  const [canPublish, setCanPublish] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [role, setRole] = useState(
    conference.current_user_role || "participant",
  );
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState("chat");
  const [meetingMessages, setMeetingMessages] = useState([]);
  const [questionMessages, setQuestionMessages] = useState([]);
  const questionMessagesRef = useRef([]);
  questionMessagesRef.current = questionMessages;
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [participantPage, setParticipantPage] = useState(0);
  const [questionPage, setQuestionPage] = useState(0);
  const [moreQuestions, setMoreQuestions] = useState(false);
  const [conferenceStatus, setConferenceStatus] = useState(conference.status);
  const [participants, setParticipants] = useState([]);
  const [participantMeta, setParticipantMeta] = useState({
    total: 0,
    raised_count: 0,
  });
  const [participantSearch, setParticipantSearch] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageMode, setMessageMode] = useState("message");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [handBusy, setHandBusy] = useState(false);
  const [handRaised, setHandRaised] = useState(false);

  function userIdFromIdentity(identity) {
    const match = String(identity || "").match(/^user-(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  const mergeMessages = mergeConferenceMessages;
  const readOnly = historyOnly || ["completed", "cancelled"].includes(conferenceStatus);

  useEffect(()=>{if(readOnly&&!historyOnly){roomRef.current?.disconnect();setCanPublish(false);setMic(false);setCamera(false);setSharing(false);}},[readOnly,historyOnly]);
  async function endMeeting(){
    if(ending||!confirm(readOnly?'Повторить отключение всех комнат этой встречи?':'Завершить встречу и отключить всех участников, включая комнаты обсуждений?'))return;
    setEnding(true);try{await request(`/api/conferences/${conference.id}`,{method:'PATCH',body:JSON.stringify({status:'completed'})});setConferenceStatus('completed');setConnection('Встреча завершена');notify('Встреча завершена, комнаты отключены');}catch(e){notify(e.message,'error');refreshRoomRef.current();}finally{setEnding(false);}
  }

  function syncRoom(room) {
    setLiveRecording(breakoutId?undefined:Boolean(room.isRecording));
    const next = [];
    const connected = [];
    const localUserId = userIdFromIdentity(room.localParticipant.identity);
    if (localUserId) connected.push(localUserId);
    for (const publication of room.localParticipant.trackPublications.values())
      if (publication.track)
        next.push({
          key: `local-${publication.trackSid}`,
          track: publication.track,
          source: publication.source,
          name: "Вы",
          local: true,
        });
    for (const participant of room.remoteParticipants.values()) {
      const participantUserId = userIdFromIdentity(participant.identity);
      if (participantUserId) connected.push(participantUserId);
      for (const publication of participant.trackPublications.values())
        if (publication.track)
          next.push({
            key: `${participant.identity}-${publication.trackSid}`,
            track: publication.track,
            source: publication.source,
            name: participant.name || "Участник",
            local: false,
          });
    }
    setMedia(next);
    setConnectedUserIds([...new Set(connected)]);
    setParticipantCount(room.remoteParticipants.size + 1);
  }

  useEffect(() => {
    if (historyOnly) return;
    let active = true;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    });
    roomRef.current = room;
    const sync = () => active && syncRoom(room);
    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.RecordingStatusChanged,
    ])
      room.on(event, sync);
    room.on(
      RoomEvent.Reconnecting,
      () => active && setConnection("Переподключение…"),
    );
    room.on(RoomEvent.Reconnected, () => {
      if (active) { setConnection("Подключено"); syncRoom(room); refreshRoomRef.current(); }
    });
    room.on(RoomEvent.Disconnected, () => active && setConnection("Отключено"));
    room.on(
      RoomEvent.AudioPlaybackStatusChanged,
      (allowed) => active && setAudioBlocked(!allowed),
    );
    room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      if (!active || _participant || topic !== "kontur.conference") return;
      try {
        const event = JSON.parse(new TextDecoder().decode(payload));
        if (Number(event.conference_id) !== Number(conference.id)) return;
        if (["message", "question"].includes(event.type) && event.message) {
          setMeetingMessages((current) =>
            mergeMessages(current, [event.message]),
          );
          if (event.message.message_type === "question")
            setQuestionMessages((current) => mergeMessages(current, [event.message]));
        }
        if (event.type === "hand") {
          setParticipants((current) =>
            current.map((participant) =>
              Number(participant.user_id) === Number(event.user_id)
                ? { ...participant, hand_raised_at: event.hand_raised_at }
                : participant,
            ),
          );
          setParticipantMeta((current) => ({
            ...current,
            raised_count: Number(event.raised_count || 0),
          }));
          if (
            Number(event.user_id) ===
            Number(userIdFromIdentity(room.localParticipant.identity))
          )
            setHandRaised(Boolean(event.raised));
        }
      } catch {
        // Неизвестные пакеты комнаты не влияют на сохранённые данные.
      }
    });
    (async () => {
      try {
        let access;
        while(active){
          access=await request(breakoutId?`/api/work/conference-tools/${conference.id}/breakouts/${breakoutId}/token?${new URLSearchParams({join_code:conference.join_code||''})}`:`/api/conferences/${conference.id}/token`,{method:'POST',body:JSON.stringify({join_code:conference.join_code})});
          if(!access.waiting)break;
          setWaiting(true);setConnection('Ожидаем допуска организатора');
          await new Promise(resolve=>setTimeout(resolve,3000));
        }
        if(active)setWaiting(false);
        if (!active) return;
        setCanPublish(access.can_publish);
        setCanModerate(Boolean(access.can_moderate));
        setCurrentUserId(Number(access.user_id));
        setRole(access.role);
        await room.connect(access.url, access.token);
        if (!active) { await room.disconnect(); return; }
        refreshRoomRef.current();
        await room.startAudio().catch(() => setAudioBlocked(true));
        if (access.can_publish) {
          const audioOptions = joinSettingsRef.current.audioId
            ? {
                deviceId: { exact: joinSettingsRef.current.audioId },
                echoCancellation: true,
                noiseSuppression: true,
              }
            : { echoCancellation: true, noiseSuppression: true };
          const videoOptions = joinSettingsRef.current.videoId
            ? { deviceId: { exact: joinSettingsRef.current.videoId } }
            : undefined;
          if (joinSettingsRef.current.audio)
            await room.localParticipant.setMicrophoneEnabled(
              true,
              audioOptions,
            );
          if (joinSettingsRef.current.video)
            await room.localParticipant.setCameraEnabled(true, videoOptions);
          setMic(Boolean(joinSettingsRef.current.audio));
          setCamera(Boolean(joinSettingsRef.current.video));
        }
        setConnection("Подключено");
        syncRoom(room);
      } catch (error) {
        if(!active)return;
        setWaiting(false);
        setConnection("Ошибка подключения");
        notify(error.message, "error");
      }
    })();
    return () => {
      active = false;
      room.disconnect();
      roomRef.current = null;
    };
  }, [conference.id, historyOnly, breakoutId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    let busy = false;
    const controller = new AbortController();
    messagesAfterRef.current = null;
    setMeetingMessages([]);
    async function loadMeetingMessages() {
      if (!active || busy) return;
      busy = true;
      try {
        let fullPage;
        do {
          const initial = messagesAfterRef.current === null;
          const query = new URLSearchParams({ limit: initial ? "100" : "250", join_code: conference.join_code });
          if (!initial) query.set("after", String(messagesAfterRef.current));
          const next = await request(`/api/conferences/${conference.id}/messages?${query}`, { signal: controller.signal });
          if (!active) return;
          if (initial) setHasOlderMessages(next.length === 100);
          messagesAfterRef.current = Math.max(messagesAfterRef.current || 0, ...next.map((message) => Number(message.id)));
          setMeetingMessages((current) => mergeMessages(current, next));
          fullPage = !initial && next.length === 250;
        } while (active && fullPage);
        setHistoryError("");
      } catch (error) {
        if (active) setHistoryError(error.message);
      } finally {
        busy = false;
        if (active) setMessagesLoading(false);
      }
    }
    refreshRoomRef.current = loadMeetingMessages;
    loadMeetingMessages();
    const timer = setInterval(loadMeetingMessages, 30000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [conference.id, conference.join_code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let busy = false;
    async function refreshQuestions() {
      if (busy) return;
      busy = true;
      const previousIds = new Set(questionMessagesRef.current.map((message) => Number(message.id)));
      try {
        const query = new URLSearchParams({ join_code: conference.join_code, limit: "100", offset: String(questionPage * 100) });
        const next = await request(
          `/api/conferences/${conference.id}/questions?${query}`,
          { signal: controller.signal },
        );
        if (active) {
          setMoreQuestions(next.length === 100);
          const nextIds = new Set(next.map((message) => Number(message.id)));
          setQuestionMessages((current) => mergeMessages(
            current.filter((message) => nextIds.has(Number(message.id)) || !previousIds.has(Number(message.id))),
            next,
          ));
          setMeetingMessages((current) => mergeMessages(current, next.filter((entry) => current.some((item) => Number(item.id) === Number(entry.id)))));
        }
      } catch (error) {
        if (active) setHistoryError(error.message);
      } finally { busy = false; }
    }
    refreshQuestions();
    const timer = setInterval(refreshQuestions, 30000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [conference.id, conference.join_code, questionPage, panelTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let active = true;
    let reported = false;
    const controller = new AbortController();
    let busy = false;
    async function loadParticipants() {
      if (busy || !active) return;
      busy = true;
      try {
        const query = new URLSearchParams({
          join_code: conference.join_code,
          limit: "100",
          offset: String(participantPage * 100),
        });
        if (participantSearch.trim()) query.set("q", participantSearch.trim());
        const result = await request(
          `/api/conferences/${conference.id}/participants?${query}`,
          { signal: controller.signal },
        );
        if (!active) return;
        setParticipants(result.participants || []);
        setParticipantMeta({
          total: Number(result.total || 0),
          raised_count: Number(result.raised_count || 0),
          matching_count: Number(result.matching_count || 0),
        });
        setHandRaised(Boolean(result.own_hand_raised_at));
        setConferenceStatus(result.status);
        setCurrentUserId((current) => current || Number(result.current_user_id));
        setCanModerate(Boolean(result.can_moderate));
      } catch (error) {
        if (active && !reported) {
          reported = true;
          notify(`Список участников недоступен: ${error.message}`, "error");
        }
      } finally { busy = false; }
    }
    const debounce = setTimeout(loadParticipants, 200);
    const timer = setInterval(loadParticipants, 30000);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [conference.id, conference.join_code, participantSearch, participantPage, panelTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (panelTab !== "chat") return;
    const container = chatScrollRef.current;
    if (container && scrollToBottomRef.current) container.scrollTop = container.scrollHeight;
  }, [meetingMessages.length, panelTab, panelOpen]);

  useEffect(() => {
    const previousFocus = document.activeElement;
    meetingDialogRef.current?.focus();
    return () => previousFocus?.focus?.();
  }, []);

  useEffect(() => {
    // Mobile keyboards resize the visual viewport, not always the CSS viewport.
    const room = meetingDialogRef.current;
    const viewport = window.visualViewport;
    let frame;
    const update = () => {
      if (!room || (viewport && viewport.scale > 1.05)) return;
      const height = viewport?.height || window.innerHeight;
      room.style.setProperty('--meeting-viewport-height', `${height}px`);
      room.style.setProperty('--meeting-viewport-top', `${viewport?.offsetTop || 0}px`);
      room.classList.toggle('compact-viewport', height < 520);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, []);

  useEffect(() => {
    const input = composerRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(112, input.scrollHeight + 2)}px`;
  }, [messageDraft, panelOpen, panelTab]);

  async function loadOlderMessages() {
    if (olderLoading || !meetingMessages.length) return;
    setOlderLoading(true);
    const container = chatScrollRef.current;
    const previousHeight = container?.scrollHeight || 0;
    try {
      const query = new URLSearchParams({ before: String(meetingMessages[0].id), limit: "100", join_code: conference.join_code });
      const next = await request(`/api/conferences/${conference.id}/messages?${query}`);
      scrollToBottomRef.current = false;
      setHasOlderMessages(next.length === 100);
      setMeetingMessages((current) => mergeMessages(current, next));
      requestAnimationFrame(() => { if (container) container.scrollTop += container.scrollHeight - previousHeight; });
    } catch (error) { notify(error.message, "error"); }
    finally { setOlderLoading(false); }
  }

  async function toggle(kind) {
    const room = roomRef.current;
    if (!room || !canPublish) return;
    try {
      if (kind === "mic") {
        await room.localParticipant.setMicrophoneEnabled(!mic);
        setMic(!mic);
      } else {
        await room.localParticipant.setCameraEnabled(!camera);
        setCamera(!camera);
      }
      syncRoom(room);
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function share() {
    const room = roomRef.current;
    if (!room || !canPublish) return;
    try {
      await room.localParticipant.setScreenShareEnabled(!sharing, {
        audio: true,
        preferCurrentTab: true,
      });
      setSharing(!sharing);
      syncRoom(room);
    } catch (error) {
      notify(`Демонстрация экрана не запущена: ${error.message}`, "error");
    }
  }

  async function sendMeetingMessage(event) {
    event.preventDefault();
    const body = messageDraft.trim();
    if (!body || sendingRef.current || readOnly) return;
    sendingRef.current = true;
    setSendingMessage(true);
    try {
      if (!messageRequestRef.current || messageRequestRef.current.body !== body || messageRequestRef.current.message_type !== messageMode)
        messageRequestRef.current = { body, message_type: messageMode, client_id: crypto.randomUUID() };
      const created = await request(
        `/api/conferences/${conference.id}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            ...messageRequestRef.current,
            join_code: conference.join_code,
          }),
        },
      );
      scrollToBottomRef.current = true;
      setMeetingMessages((current) => mergeMessages(current, [created]));
      if (created.message_type === "question")
        setQuestionMessages((current) => mergeMessages(current, [created]));
      messageRequestRef.current = null;
      setMessageDraft("");
      if (messageMode === "question") {
        setPanelTab("questions");
        notify("Вопрос добавлен в очередь");
      }
    } catch (error) {
      notify(error.message, "error");
    } finally {
      sendingRef.current = false;
      setSendingMessage(false);
    }
  }

  async function toggleHand() {
    if (handBusy || readOnly) return;
    const raised = !handRaised;
    setHandBusy(true);
    try {
      const result = await request(`/api/conferences/${conference.id}/hand`, {
        method: "POST",
        body: JSON.stringify({
          raised,
          join_code: conference.join_code,
        }),
      });
      setParticipants((current) =>
        current.map((participant) =>
          Number(participant.user_id) === Number(currentUserId)
            ? { ...participant, hand_raised_at: result.hand_raised_at }
            : participant,
        ),
      );
      setHandRaised(Boolean(result.raised));
      setParticipantMeta((current) => ({
        ...current,
        raised_count: Number(result.raised_count || 0),
      }));
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setHandBusy(false);
    }
  }

  async function lowerHand(participantId) {
    try {
      const result = await request(
        `/api/conferences/${conference.id}/participants/${participantId}`,
        { method: "PATCH", body: JSON.stringify({ raised: false }) },
      );
      setParticipants((current) =>
        current.map((participant) =>
          Number(participant.user_id) === Number(participantId)
            ? { ...participant, hand_raised_at: null }
            : participant,
        ),
      );
      if (Number(participantId) === Number(currentUserId)) setHandRaised(false);
      setParticipantMeta((current) => ({
        ...current,
        raised_count: Number(result.raised_count || 0),
      }));
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function moderateQuestion(messageId, status) {
    try {
      const updated = await request(
        `/api/conferences/${conference.id}/questions/${messageId}`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      setMeetingMessages((current) => mergeMessages(current, [updated]));
      setQuestionMessages((current) => mergeMessages(current, [updated]));
    } catch (error) {
      notify(error.message, "error");
    }
  }

  function openPanel(tab) {
    scrollToBottomRef.current = true;
    setPanelTab(tab);
    setMessageMode(tab === "questions" ? "question" : "message");
    setPanelOpen(true);
  }

  function downloadChat() {
    const link = document.createElement("a");
    link.href = `/api/conferences/${conference.id}/transcript?${new URLSearchParams({ join_code: conference.join_code })}`;
    link.download = `conference-${conference.id}-chat.txt`;
    link.click();
  }

  function leaveMeeting() {
    if (!historyOnly && handRaised && !readOnly)
      request(`/api/conferences/${conference.id}/hand`, {
        method: "POST", keepalive: true,
        body: JSON.stringify({ raised: false, join_code: conference.join_code }),
      }).catch(() => {});
    onClose();
  }

  const videoTracks = media.filter(
    (item) => item.track.kind === Track.Kind.Video,
  );
  const audioTracks = media.filter(
    (item) => item.track.kind === Track.Kind.Audio && !item.local,
  );
  const questions = questionMessages
    .filter((message) => message.message_type === "question")
    .sort((a, b) => {
      if ((a.question_status === "open") !== (b.question_status === "open"))
        return a.question_status === "open" ? -1 : 1;
      return Number(a.id) - Number(b.id);
    });
  const openQuestions = questions.filter(
    (message) => message.question_status === "open",
  ).length;
  const roleNames = {
    host: "организатор",
    presenter: "докладчик",
    participant: "участник",
  };
  const orderedParticipants = [...participants].sort((a, b) => {
    if (Boolean(a.hand_raised_at) !== Boolean(b.hand_raised_at)) return a.hand_raised_at ? -1 : 1;
    return a.hand_raised_at ? conferenceDate(a.hand_raised_at) - conferenceDate(b.hand_raised_at) : 0;
  });
  return (
    <div className={`meeting-room ${panelOpen ? "panel-open" : ""} ${historyOnly ? "meeting-history" : ""}`}
      ref={meetingDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={conference.title}
      onKeyDown={(event) => {
        if (event.key === "Escape") { historyOnly ? onClose() : setPanelOpen(false); return; }
        if (event.key !== "Tab") return;
        const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')].filter((node) => node.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="meeting-topbar">
        {!breakoutId&&<ConferenceRecordings conference={conference} inRoom liveRecording={liveRecording}/>}
        {breakoutId&&<button className="secondary" onClick={()=>{joinSettingsRef.current={...settings,audio:mic,video:camera};setBreakoutId(null);}}>В общую комнату</button>}
        <span>
          <strong>{conference.title}</strong>
          <small>
            {formatDate(conference.scheduled_start, true)} · {historyOnly ? "История конференции" : connection}
          </small>
        </span>
        {!historyOnly && <b>
          {participantCount} в комнате
          {participantMeta.total ? ` · ${participantMeta.total} участников` : ""}
          {participantMeta.raised_count
            ? ` · ✋ ${participantMeta.raised_count}`
            : ""}
          {` · ${roleNames[role] || "участник"}`}
        </b>}
        {historyOnly && <button className="meeting-history-close" onClick={onClose}>Закрыть историю</button>}
      </header>
      <div className="meeting-context">
      {waiting&&<div className="meeting-lobby-banner" role="status">Вы в зале ожидания. Микрофон и камера ещё не подключены к встрече.</div>}
      {breakoutId&&<div className="meeting-lobby-banner">Комната обсуждения · чат общий · запись основной встречи не включает эту комнату</div>}
      <ConferenceCaptions conference={conference} roomRef={roomRef} mic={mic} canPublish={canPublish} readOnly={readOnly} breakoutId={breakoutId} notify={notify}/>
      </div>
      <div className="meeting-room-body">
        {!historyOnly && <div
          className={`video-grid ${videoTracks.length === 0 ? "audience-only" : ""}`}
        >
          {audioTracks.map((item) => (
            <LiveKitTrack item={item} key={item.key} />
          ))}
          {videoTracks.length ? (
            videoTracks.map((item) => (
              <figure key={item.key}>
                <LiveKitTrack item={item} />
                <figcaption>
                  {item.name} ·{" "}
                  {item.source === Track.Source.ScreenShare ? "экран" : "камера"}
                </figcaption>
              </figure>
            ))
          ) : (
            <div className="webinar-stage">
              <strong>Ожидаем трансляцию ведущего</strong>
              <span>
                Вы подключены к конференции. Видео появится здесь автоматически.
              </span>
            </div>
          )}
        </div>}
        {panelOpen && (
          <aside className="meeting-panel" aria-label="Совместная работа">
            <header className="meeting-panel-head">
              <nav aria-label="Разделы конференции">
                <button
                  className={panelTab === "chat" ? "active" : ""}
                  onClick={() => openPanel("chat")}
                >
                  Чат <small>{meetingMessages.length}</small>
                </button>
                <button
                  className={panelTab === "questions" ? "active" : ""}
                  onClick={() => openPanel("questions")}
                >
                  Вопросы {openQuestions > 0 && <small>{openQuestions}</small>}
                </button>
                {!historyOnly && <button
                  className={panelTab === "participants" ? "active" : ""}
                  onClick={() => openPanel("participants")}
                >
                  Люди <small>{participantMeta.total}</small>
                </button>}
                <button className={panelTab === "tools" ? "active" : ""} onClick={()=>openPanel("tools")}>Инструменты</button>
              </nav>
              <button
                className="meeting-panel-close"
                onClick={() => historyOnly ? onClose() : setPanelOpen(false)}
                aria-label="Закрыть панель"
              >
                ×
              </button>
            </header>

            {historyError && <div className="meeting-sync-error" role="alert">{historyError}<button onClick={() => refreshRoomRef.current()}>Повторить</button></div>}

            {panelTab === "tools" && <ConferenceTools conference={conference} canModerate={canModerate} notify={notify} readOnly={readOnly} activeRoom={breakoutId} onSwitch={id=>{joinSettingsRef.current={...settings,audio:mic,video:camera};setMedia([]);setCanPublish(false);setSharing(false);setConnection("Переходим в комнату…");setBreakoutId(id);}}/>}
            {panelTab === "chat" && (
              <div className="meeting-message-list" ref={chatScrollRef} onScroll={(event) => {
                const el = event.currentTarget;
                scrollToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
              }}>
                <div className="meeting-history-note">
                  <span>●</span> История сохраняется в конференции
                  <button onClick={downloadChat} disabled={messagesLoading || Boolean(historyError)}>
                    Скачать всё
                  </button>
                </div>
                {hasOlderMessages && <button className="meeting-load-older" disabled={olderLoading} onClick={loadOlderMessages}>{olderLoading ? "Загрузка…" : "Предыдущие сообщения"}</button>}
                {messagesLoading && <div className="meeting-panel-empty" role="status">Загрузка истории…</div>}
                {meetingMessages.map((message) => (
                  <article
                    className={`meeting-message ${message.message_type}`}
                    key={message.id}
                  >
                    <Avatar
                      user={{
                        display_name: message.sender_name,
                        avatar_color: message.sender_color,
                      }}
                    />
                    <div>
                      <header>
                        <strong>{message.sender_name}</strong>
                        <time>{formatDate(message.created_at, true)}</time>
                      </header>
                      {message.message_type === "question" && (
                        <span className={`question-state ${message.question_status}`}>
                          Вопрос ·{" "}
                          {message.question_status === "answered"
                            ? "отвечен"
                            : message.question_status === "dismissed"
                              ? "закрыт"
                              : "ждёт ответа"}
                        </span>
                      )}
                      <p>{message.body}</p>
                    </div>
                  </article>
                ))}
                {!messagesLoading && !historyError && !meetingMessages.length && (
                  <div className="meeting-panel-empty">
                    {historyOnly ? "В этой конференции пока нет сообщений." : "Начните обсуждение — сообщения увидят все участники."}
                  </div>
                )}
              </div>
            )}

            {panelTab === "questions" && (
              <div className="meeting-question-list" id="meeting-questions">
                <div className="meeting-panel-caption">
                  <span>{openQuestions} открытых на странице</span>
                  <small>Вопросы не теряются в общем чате</small>
                </div>
                {questions.map((question) => (
                  <article
                    className={`meeting-question ${question.question_status}`}
                    key={question.id}
                  >
                    <header>
                      <strong>{question.sender_name}</strong>
                      <time>{formatDate(question.created_at, true)}</time>
                    </header>
                    <p>{question.body}</p>
                    <footer>
                      <span className={`question-state ${question.question_status}`}>
                        {question.question_status === "answered"
                          ? "Отвечен"
                          : question.question_status === "dismissed"
                            ? "Закрыт"
                            : "Ждёт ответа"}
                      </span>
                      {canModerate && !historyOnly && question.question_status === "open" && (
                        <span>
                          <button
                            onClick={() => moderateQuestion(question.id, "answered")}
                          >
                            Ответили
                          </button>
                          <button
                            onClick={() => moderateQuestion(question.id, "dismissed")}
                          >
                            Закрыть
                          </button>
                        </span>
                      )}
                      {canModerate && !historyOnly && question.question_status !== "open" && (
                        <button onClick={() => moderateQuestion(question.id, "open")}>
                          Вернуть
                        </button>
                      )}
                    </footer>
                  </article>
                ))}
                {(questionPage > 0 || moreQuestions) && <div className="meeting-pagination"><button disabled={!questionPage} onClick={() => setQuestionPage((page) => page - 1)}>Назад</button><span>Страница {questionPage + 1}</span><button disabled={!moreQuestions} onClick={() => setQuestionPage((page) => page + 1)}>Далее</button></div>}
                {!questions.length && (
                  <div className="meeting-panel-empty">
                    {historyOnly ? "На этой странице нет вопросов." : "Нажмите «Задать вопрос», чтобы попасть в очередь ведущего."}
                  </div>
                )}
              </div>
            )}

            {panelTab === "participants" && (
              <div className="meeting-participant-pane">
                <label className="meeting-participant-search">
                  <span>Поиск участника</span>
                  <input
                    value={participantSearch}
                    maxLength={120}
                    onChange={(event) => { setParticipantSearch(event.target.value); setParticipantPage(0); }}
                    placeholder="Имя сотрудника"
                  />
                </label>
                <div className="meeting-participant-list">
                  {orderedParticipants.map((participant) => {
                    const online = connectedUserIds.includes(
                      Number(participant.user_id),
                    );
                    return (
                      <article key={participant.user_id}>
                        <Avatar user={participant} online={online} />
                        <span>
                          <strong>{participant.display_name}</strong>
                          <small>
                            {roleNames[participant.participant_role] || "участник"}
                            {online ? " · в комнате" : ""}
                          </small>
                        </span>
                        {participant.hand_raised_at && (
                          <button
                            className="raised-hand-chip"
                            onClick={() =>
                              canModerate && lowerHand(participant.user_id)
                            }
                            disabled={!canModerate}
                            title={canModerate ? "Опустить руку" : "Рука поднята"}
                          >
                            ✋
                          </button>
                        )}
                      </article>
                    );
                  })}
                  {!participants.length && (
                    <div className="meeting-panel-empty">Никого не найдено</div>
                  )}
                </div>
                {(participantPage > 0 || participantMeta.matching_count > 100) && <div className="meeting-pagination"><button disabled={!participantPage} onClick={() => setParticipantPage((page) => page - 1)}>Назад</button><span>{participantPage * 100 + 1}–{participantPage * 100 + participants.length} из {participantMeta.matching_count}</span><button disabled={(participantPage + 1) * 100 >= participantMeta.matching_count} onClick={() => setParticipantPage((page) => page + 1)}>Далее</button></div>}
              </div>
            )}

            {["chat","questions"].includes(panelTab) && !readOnly && (
              <form className="meeting-composer" onSubmit={sendMeetingMessage}>
                <div className="meeting-message-mode">
                  <button
                    type="button"
                    className={messageMode === "message" ? "active" : ""}
                    onClick={() => setMessageMode("message")}
                  >
                    Сообщение
                  </button>
                  <button
                    type="button"
                    className={messageMode === "question" ? "active" : ""}
                    onClick={() => setMessageMode("question")}
                  >
                    Задать вопрос
                  </button>
                </div>
                <textarea
                  ref={composerRef}
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows="2"
                  maxLength="4000"
                  aria-label={messageMode === "question" ? "Вопрос ведущему" : "Сообщение участникам"}
                  disabled={sendingMessage}
                  placeholder={
                    messageMode === "question"
                      ? "Сформулируйте вопрос ведущему…"
                      : "Сообщение всем участникам…"
                  }
                />
                <div>
                  <small>{messageDraft.length}/4000<span className="meeting-keyboard-hint"> · Enter — отправить<br/>Shift+Enter — новая строка</span></small>
                  <button disabled={!messageDraft.trim() || sendingMessage}>
                    {sendingMessage
                      ? "Отправляем…"
                      : messageMode === "question"
                        ? "Спросить"
                        : "Отправить"}
                  </button>
                </div>
              </form>
            )}
            {readOnly && <div className="meeting-readonly">История доступна для чтения и скачивания</div>}
          </aside>
        )}
      </div>
      {!historyOnly && <footer className="meeting-toolbar">
        {audioBlocked && (
          <button
            className="attention"
            onClick={() =>
              roomRef.current
                ?.startAudio()
                .then(() => setAudioBlocked(false))
                .catch((error) => notify(error.message, "error"))
            }
          >
            🔊 Включить звук
          </button>
        )}
        {canPublish && (
          <>
            <button
              className={mic ? "active" : "off"}
              onClick={() => toggle("mic")}
            >
              🎙 {mic ? "Микрофон" : "Без звука"}
            </button>
            <button
              className={camera ? "active" : "off"}
              onClick={() => toggle("camera")}
            >
              📹 {camera ? "Камера" : "Камера выкл."}
            </button>
            <button className={sharing ? "active" : ""} onClick={share}>
              ▣ {sharing ? "Экран виден" : "Показать экран"}
            </button>
          </>
        )}
        <button
          className={handRaised ? "active raised" : ""}
          onClick={toggleHand}
          disabled={handBusy || readOnly || !currentUserId}
          aria-pressed={handRaised}
        >
          ✋ {handRaised ? "Рука поднята" : "Поднять руку"}
        </button>
        <button onClick={() => openPanel("questions")} aria-controls="meeting-questions">Задать вопрос</button>
        <button
          className={panelOpen ? "active" : ""}
          aria-expanded={panelOpen}
          onClick={() =>
            panelOpen ? setPanelOpen(false) : openPanel("chat")
          }
        >
          💬 Чат{openQuestions ? ` · ${openQuestions}` : ""}
        </button>
        {canModerate&&<button disabled={ending} onClick={endMeeting}>{ending?'Отключаем комнаты…':readOnly?'Повторить отключение':'Завершить для всех'}</button>}
        <button className="leave" onClick={leaveMeeting}>
          Выйти
        </button>
      </footer>}
    </div>
  );
}
