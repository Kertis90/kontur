# API Контур Work

Новые методы `/api/work/integrations`: [подключения, журнал, тесты и повторная доставка](INTEGRATIONS.md#api). Также опубликованы в «Мой API» и `/api/openapi.json`.

REST API использует JSON, моменты времени ISO 8601 UTC и календарные даты YYYY-MM-DD и персональный Bearer-токен. Интерактивный каталог находится в интерфейсе **Мой API**, а актуальный машиночитаемый контракт доступен по `GET /api/openapi.json`.

## Авторизация и права

```bash
KONTUR_TOKEN="ВСТАВЬТЕ_ПОЛНЫЙ_ТОКЕН"

curl --request GET \
  --url "https://projects.company.ru/api/search" \
  --header "Authorization: Bearer $KONTUR_TOKEN" \
  --get \
  --data-urlencode "q=assignee = currentUser()"
```

Префикс токена из таблицы — только идентификатор. Для запроса нужен полный секрет, показанный сразу после выпуска. Сервер последовательно проверяет scope токена, политику API пользователя и его обычные разрешения в проекте. Ответы об ошибках имеют вид `{ "error": "...", "details": ... }`.

## Основные методы

| Метод | Путь | Scope | Разрешение | Назначение |
| --- | --- | --- | --- | --- |
| GET | `/api/search` | `tasks:read` | `project.browse` | Поиск задач |
| GET | `/api/tasks/{taskId}/details` | `tasks:read` | `project.browse` | Карточка задачи |
| POST | `/api/tasks` | `tasks:write` | `task.create` | Создание задачи |
| PATCH | `/api/tasks/{taskId}` | `tasks:write` | `task.edit` | Изменение задачи |
| GET | `/api/projects/{projectId}` | `projects:read` | `project.browse` | Данные проекта |
| POST | `/api/projects` | `projects:write` | `project.create` | Создание проекта |

## Чаты

| Метод | Путь | Scope | Назначение |
| --- | --- | --- | --- |
| GET | `/api/chat/channels` | `chat:read` | Доступные каналы |
| POST | `/api/chat/channels` | `chat:write` | Создание канала |
| GET | `/api/chat/channels/{channelId}/messages?after=0` | `chat:read` | Новые сообщения, максимум 250 |
| POST | `/api/chat/channels/{channelId}/messages` | `chat:write` | Отправка сообщения |
| GET | `/api/chat/presence` | `chat:read` | Доступность сотрудников |
| POST | `/api/chat/presence` | `chat:write` | Обновление своего статуса |
| POST | `/api/chat/channels/{channelId}/attachments/presign` | `chat:write` | URL загрузки файла |
| POST | `/api/chat/channels/{channelId}/attachments/complete` | `chat:write` | Публикация загруженного файла |

Загрузка файла выполняется в два шага: получить `upload_url`, загрузить в него исходные байты методом PUT, затем подтвердить `object_key` через `complete`. Лимит по умолчанию — 25 МБ.

## Конференции

| Метод | Путь | Scope | Разрешение проекта | Назначение |
| --- | --- | --- | --- | --- |
| GET | `/api/conferences` | `conference:read` | приглашение/ссылка/организатор | Доступные встречи |
| GET | `/api/conferences/join/{joinCode}` | `conference:read` | ссылка/приглашение | Открытие встречи по уникальной ссылке |
| POST | `/api/conferences` | `conference:write` | `conference.create` | Планирование или мгновенный запуск (`start_now`) |
| PATCH | `/api/conferences/{conferenceId}` | `conference:write` | `conference.manage` | Время, участники и статус |
| POST | `/api/conferences/{conferenceId}/token` | `conference:write` | приглашение/ссылка/организатор | Короткоживущий LiveKit-токен |
| GET | `/api/conferences/{conferenceId}/transcript` | `conference:read` | приглашение/ссылка/организатор | Полная выгрузка чата и вопросов в TXT |
| GET | `/api/conferences/{conferenceId}/messages?after=0` | `conference:read` | приглашение/ссылка/организатор | Сохранённая история чата |
| POST | `/api/conferences/{conferenceId}/messages` | `conference:write` | приглашение/ссылка/организатор | Сообщение или вопрос ведущему |
| GET | `/api/conferences/{conferenceId}/questions` | `conference:read` | приглашение/ссылка/организатор | Очередь вопросов и статусы |
| PATCH | `/api/conferences/{conferenceId}/questions/{messageId}` | `conference:write` | `conference.manage` | Ответить, закрыть или вернуть вопрос |
| GET | `/api/conferences/{conferenceId}/participants` | `conference:read` | приглашение/ссылка/организатор | Участники, роли и поднятые руки |
| POST | `/api/conferences/{conferenceId}/hand` | `conference:write` | приглашение/ссылка/организатор | Поднять или опустить свою руку |
| PATCH | `/api/conferences/{conferenceId}/participants/{userId}` | `conference:write` | `conference.manage` | Опустить руку участника |

Количество подключений заранее не задаётся, а LiveKit-комната создаётся без `maxParticipants`. Если `participant_ids` и `presenter_ids` пусты, API возвращает `join_code`: авторизованные сотрудники могут открыть `/?conference={join_code}`, а затем передать тот же код в `/token`. Если приглашённые указаны, ссылка работает только для них. Для встречи около 1000 человек используйте вебинар и держите число ведущих небольшим.

Чат конференции и вопросы сохраняются в MySQL. На карточке встречи кнопка «История чата и вопросов» открывает их без подключения к медиасерверу; переключатель «Все встречи и история» включает встречи старше недели (`GET /api/conferences?history=true`). Завершённая встреча доступна для чтения; отправка сообщений и поднятие руки возвращают 409.

`GET /messages` без курсора возвращает последние 100 сообщений. Для новых записей передавайте `after=ID`, для старых — `before=ID`, для чтения с начала — `after=0`. Курсоры взаимоисключающие. `limit` — от 1 до 250, ответ всегда упорядочен по возрастанию ID. `GET /transcript` выгружает всю историю до момента начала запроса потоком в UTF-8 `.txt`; включает авторов, UTC-время, вопросы и их статусы. Выгрузка не ограничивается загруженной в браузере страницей.

`POST /messages` принимает `body` (1–4000 символов), `message_type=message|question` и необязательный UUID `client_id`. При сетевом сбое повторяйте тот же `client_id`: одна попытка создаёт одну запись, даже при повторной отправке. Повтор UUID с другим текстом или типом возвращает 409.

Вопросы имеют статусы `open`, `answered`, `dismissed`. `GET /questions?limit=100&offset=0` возвращает сначала открытые вопросы, затем остальные, по ID внутри группы; максимум 250 за запрос. `revision` растёт при модерации: клиент не должен заменять сообщение старой ревизией. Организатор или пользователь с `conference.manage` может менять статус вопроса и опускать чужую руку.

`GET /participants?q=Анна&limit=100&offset=0` поддерживает страницы до 500 участников. Ответ содержит `participants`, `total`, `matching_count`, `raised_count`, `own_hand_raised_at`, `can_moderate` и `status` встречи. Собственная рука возвращается независимо от фильтра и страницы. Повторное поднятие сохраняет место в очереди.

Все методы требуют входа и проверки API-политики и scope для токенов. Чтение и участие доступны организатору, приглашённым, модератору (`conference.manage`) или сотруднику того же рабочего пространства с действующим `join_code` для встречи с `join_policy=link`. Знание ID встречи само по себе доступа не даёт. Приватный чат нельзя получить через экспорт без той же проверки.

Уведомления об изменениях отправляет сервер через LiveKit после сохранения в MySQL. Клиенты получают новые записи и восстанавливают историю при переподключении; резервный опрос работает каждые 30 секунд. Медиатокен не разрешает клиенту рассылать системные события (`canPublishData=false`).

## База знаний

| Метод | Путь | Scope | Назначение |
| --- | --- | --- | --- |
| GET | `/api/knowledge/teams` | `knowledge:read` | Доступные команды и роль пользователя |
| POST | `/api/knowledge/teams` | `knowledge:write` | Создание команды, участников и руководителей |
| PATCH | `/api/knowledge/teams/{teamId}` | `knowledge:write` | Изменение состава и ролей команды |
| GET | `/api/knowledge/spaces` | `knowledge:read` | Пространства с вычисленным уровнем доступа |
| POST | `/api/knowledge/spaces` | `knowledge:write` | Создание пространства с командой-владельцем |
| PATCH | `/api/knowledge/spaces/{spaceId}` | `knowledge:write` | Видимость, описание и команда пространства |
| GET | `/api/knowledge/spaces/{spaceId}/permissions` | `knowledge:read` | Чтение ACL администратором пространства |
| PUT | `/api/knowledge/spaces/{spaceId}/permissions` | `knowledge:write` | Полная замена ACL пользователей и команд |
| GET | `/api/knowledge/articles/{articleId}` | `knowledge:read` | Получение доступной статьи |
| POST | `/api/knowledge/articles` | `knowledge:write` | Создание статьи при уровне `edit` |
| PATCH | `/api/knowledge/articles/{articleId}` | `knowledge:write` | Изменение статьи при уровне `edit` |

ACL пространства принимает `principal_type=user|team` и `access_level=view|edit|admin`. Глобальный администратор базы знаний видит всё; руководитель команды управляет её составом, а права команды суммируются с персональными правами пользователя.

## Телефония

| Метод | Путь | Scope | Разрешение проекта | Назначение |
| --- | --- | --- | --- | --- |
| GET | `/api/telephony/status` | `telephony:read` | — | Готовность шлюза без секретов |
| GET | `/api/telephony/calls?projectId=1` | `telephony:read` | `telephony.view` | Журнал звонков проекта |
| GET | `/api/telephony/calls/{callId}` | `telephony:read` | `telephony.view` | Один звонок |
| POST | `/api/telephony/calls` | `telephony:write` | `telephony.call` | Исходящий звонок |
| POST | `/api/telephony/calls/{callId}/hangup` | `telephony:write` | `telephony.call` | Завершение звонка |

Пример исходящего звонка:

```bash
curl --request POST \
  --url "https://projects.company.ru/api/telephony/calls" \
  --header "Authorization: Bearer $KONTUR_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"project_id":1,"to_number":"+74951234567","task_id":42,"record":false}'
```

### Контракт телефонного шлюза

Контур Work не привязан к конкретной АТС. Адаптер провайдера задаётся переменными `TELEPHONY_API_URL`, `TELEPHONY_API_TOKEN`, `TELEPHONY_WEBHOOK_SECRET`, `TELEPHONY_FROM_NUMBER` и `TELEPHONY_TIMEOUT_MS`.

Для старта вызова платформа выполняет `POST {TELEPHONY_API_URL}/calls` с Bearer-токеном и телом:

```json
{
  "client_call_id": "123",
  "from_number": "+74950000000",
  "to_number": "+74951234567",
  "record": false,
  "callback_url": "https://projects.company.ru/api/telephony/webhook",
  "metadata": { "workspace_id": 1, "project_id": 1, "task_id": 42, "conference_id": null }
}
```

Шлюз отвечает `{ "id": "provider-id", "status": "queued" }`. Для завершения платформа вызывает `POST {TELEPHONY_API_URL}/calls/{provider-id}/hangup`.

Статусы шлюз отправляет в `callback_url`:

```json
{
  "provider_call_id": "provider-id",
  "status": "completed",
  "started_at": "2026-09-04T10:00:00.000Z",
  "answered_at": "2026-09-04T10:00:05.000Z",
  "ended_at": "2026-09-04T10:02:35.000Z",
  "duration_seconds": 150,
  "failure_reason": null
}
```

Заголовок `X-Kontur-Telephony-Signature` должен содержать `sha256=<hex>`, где hex — HMAC-SHA256 от исходных байтов JSON с ключом `TELEPHONY_WEBHOOK_SECRET`. Допустимые статусы: `queued`, `ringing`, `active`, `completed`, `failed`, `cancelled`, `busy`, `no_answer`. Неизвестный `provider_call_id` безопасно игнорируется с HTTP 202.


## ИИ, проектные доступы и записи встреч (0.9.0)

Новые методы перечислены во встроенном OpenAPI. Настройки ключей ИИ доступны только с административной сессией, а не персональным токеном. Для запросов ниже администратор должен разрешить пользователю нужные scopes, а токен должен включать их. Пользовательские права действуют дополнительно.

```bash
# Задайте адрес инсталляции и полный персональный токен в переменных окружения.
export KONTUR_URL='https://projects.company.ru'
read -r -s -p 'API token: ' KONTUR_API_TOKEN
export KONTUR_API_TOKEN

# Назначить группе роль участника проекта: projects:write + project.access.manage.
curl -fsS -H "Authorization: Bearer $KONTUR_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"principal_type":"group","principal_id":3,"project_role":"member"}' \
  "$KONTUR_URL/api/projects/7/access"

# Начать запись подключённой конференции: conference:write + conference.record.
# UUID сохраняйте при повторе того же запроса; для новой записи создайте новый UUID.
curl -fsS -H "Authorization: Bearer $KONTUR_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"request_id":"dad3c9e6-dfa3-45cd-9473-a591623b659c"}' \
  "$KONTUR_URL/api/conferences/10/recordings"

# Остановить запись. ID 12 замените на полученный при создании.
curl -fsS -X POST -H "Authorization: Bearer $KONTUR_API_TOKEN" \
  "$KONTUR_URL/api/conferences/10/recordings/12/stop"

# Дождаться status=completed и поставить расшифровку в очередь.
# Требуются ai:write + ai.conference.summarize + conference.recording.view.
curl -fsS -X POST -H "Authorization: Bearer $KONTUR_API_TOKEN" \
  "$KONTUR_URL/api/conferences/10/recordings/12/transcribe"

# Проверить transcript_status: conference:read.
curl -fsS -H "Authorization: Bearer $KONTUR_API_TOKEN" \
  "$KONTUR_URL/api/conferences/10/recordings"

# При transcript_status=completed — изложение аудиозаписи, ai:write.
# Без recording_id источником будет сохранённый чат и вопросы.
curl -fsS -H "Authorization: Bearer $KONTUR_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"request_id":"8435b65a-7d4c-41aa-9aba-8c6a503f9195","recording_id":12,"instructions":"Выдели решения и поручения"}' \
  "$KONTUR_URL/api/conferences/10/ai"

# Получить результат по job.id, ai:read. Здесь 42 — пример ID.
curl -fsS -H "Authorization: Bearer $KONTUR_API_TOKEN" \
  "$KONTUR_URL/api/ai/jobs/42"
```

Постановка возвращает `202`; готовый кэш — `200`. Состояния ИИ: `queued`, `running`, `completed`, `failed`, `cancelled`. Состояния записи: `starting`, `recording`, `stopping`, `completed`, `failed`. При сетевой неопределённости запуска запись остаётся в состоянии проверки, чтобы повтор не создавал второй Egress. Рабочий процесс сверяет состояние с LiveKit и наличие файла S3.

История записи и TXT требуют `conference.recording.view`. Генерация изложения не даёт другим пользователям обходить это право. `GET /api/conferences/{id}/recordings/{recordingId}/file` поддерживает одиночный `Range`, ответы `206/416` и `download=1`; файл передаётся через проверяющее доступ приложение. Для входа по ссылке можно передать `join_code` в query; пользователь всё равно должен быть авторизован в рабочем пространстве и иметь функциональные разрешения.

Оценка проекта использует `POST /api/projects/{id}/ai` с теми же полями модели, `instructions`, `request_id`, `regenerate`, но без `recording_id`. Просмотр истории — `GET` того же пути. Подробные настройки, лимиты и модель доступа: [руководство](AI-RECORDINGS-ACCESS.md).


## Рабочие инструменты 0.11.0

Подробный каталог новых методов, scopes, форматов и ограничений: [API рабочих инструментов](API-WORK.md). Полный переносимый контракт: [OpenAPI 0.11.0](openapi-0.11.0.json). Адрес сервера в статическом файле — пример; в вашей установке `/api/openapi.json` формирует текущий адрес.

Новые методы расположены под `/api/work/`: автоматизации, согласования, загрузка, портфель, доступ к полям, временные права, поручения встреч, поиск с ИИ, совместные статьи, импорт, разработка, офлайн и личная почта. Они доступны тем же персональным токенам с соответствующими scopes и функциональными правами.

Изменение существующей статьи через `PATCH /api/knowledge/articles/{articleId}` теперь требует `version_number` из последнего GET. Конфликт возвращает 409. В обычной карточке задачи также следует передавать её `version_number`. Для массовых и офлайн-изменений версия обязательна.

Для body-массивов (`field-access`, `approval-gates`, `chapters`) передавайте непосредственно JSON-массив. PUT полностью заменяет соответствующий список.

Для `POST /api/work/offline` сохраните один UUID на операцию и повторяйте неизменное содержимое при сетевой ошибке. Новое изменение должно иметь новый UUID. Принудительное разрешение конфликта задачи выполняется только после получения текущей версии и решения пользователя.

## Опросы, зал ожидания и комнаты обсуждений

Методы `/api/work/conference-tools/{conferenceId}/…` перечислены в «Мой API» и OpenAPI: `polls`, `polls/{id}/vote`, `lobby`, `settings`, `candidates`, `breakouts`, `breakouts/{id}/token`, `attendance`. Чтение требует `conference:read`, изменения — `conference:write`, плюс доступ к самой встрече. Управление — организатор или `conference.manage`. Для входа по ссылке передайте `join_code` в query. Тело создания конференции поддерживает `waiting_room`.

Служебный `POST /api/livekit/webhook` использует подпись LiveKit вместо персонального токена. Подробные сценарии, условия посещаемости и обязательная настройка `auto_create: false`: [Инструменты конференций](CONFERENCE-TOOLS.md).


Новые методы 0.14.0 (CalDAV/GitLab, SLA, тестирование, OKR, семантический поиск, импорт Jira и эксплуатация): [API-WORK.md](API-WORK.md). Полная машиночитаемая схема — `/api/openapi.json`.
