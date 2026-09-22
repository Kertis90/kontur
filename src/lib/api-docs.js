import { WORK_API_ENDPOINTS } from './work-api-docs.js';
const jsonBody = (example) => ({ contentType: "application/json", example });

export const API_ENDPOINTS = [
  ...WORK_API_ENDPOINTS,
  { tag: "Чаты", method: "GET", path: "/api/chat/rooms", title: "Список постоянных комнат", description: "Показывает доступные общие, проектные и приглашённые комнаты. Пустая комната остаётся доступной для входа по своей политике.", scope: "chat:read", permission: "chat.room.join" },
  { tag: "Чаты", method: "POST", path: "/api/chat/rooms", title: "Создать пустую комнату", description: "Создаёт постоянную групповую комнату без добавления участников. join_policy: workspace, project или invite.", scope: "chat:write", permission: "chat.room.create", body: jsonBody({ name: "Идеи продукта", description: "Открытая комната", join_policy: "workspace", project_id: null, invite_ids: [] }) },
  { tag: "Чаты", method: "GET", path: "/api/chat/rooms/{roomId}", title: "Настройки комнаты", description: "Возвращает описание, политику, число участников и приглашения владельцу комнаты или администратору комнат.", scope: "chat:read", permission: "chat.room.join" },
  { tag: "Чаты", method: "POST", path: "/api/chat/rooms/{roomId}/join", title: "Войти в комнату", description: "Для закрытой комнаты требуется приглашение; архивная комната не принимает новых участников.", scope: "chat:write", permission: "chat.room.join" },
  { tag: "Чаты", method: "POST", path: "/api/chat/rooms/{roomId}/leave", title: "Выйти из комнаты", description: "Удаляет членство текущего пользователя. История и сама комната сохраняются.", scope: "chat:write", permission: "chat.room.join" },
  { tag: "Чаты", method: "PUT", path: "/api/chat/rooms/{roomId}", title: "Изменить комнату", description: "Меняет название, описание, приглашения и архивный статус с проверкой revision. Проект комнаты после создания неизменяем.", scope: "chat:write", permission: "chat.room.manage", body: jsonBody({ revision: 1, name: "Закрытый совет", description: "Только приглашённые", join_policy: "invite", project_id: null, invite_ids: [12], archived: false }) },
  { tag: "Чаты", method: "POST", path: "/api/chat/channels/{channelId}/read", title: "Отметить прочитанные сообщения", description: "Сохраняет максимальный прочитанный ID; старый запрос не уменьшает курсор. Сообщение должно принадлежать доступному каналу.", scope: "chat:write", permission: "chat.use", body: jsonBody({message_id:100}) },
  { tag: "Уведомления", method: "GET", path: "/api/work/push", title: "Настройки Web Push", description: "Возвращает configured и публичный VAPID-ключ. Приватный ключ не передаётся. Требуется действующая сессия браузера.", scope: "Только сессия браузера", auth:"session" },
  { tag: "Уведомления", method: "POST", path: "/api/work/push", title: "Подключить устройство", description: "Принимает PushSubscription.toJSON(). До 10 устройств пользователя. Подписка хранится зашифрованной и привязывается к текущей сессии. Переподключение того же устройства сохраняет курсоры событий пользователя. HTTPS endpoints FCM, Mozilla, Apple и Windows Push; неподдерживаемая служба возвращает 422.", scope: "Только сессия браузера", auth:"session", body:jsonBody({endpoint:"https://fcm.googleapis.com/fcm/send/DEVICE_ENDPOINT",keys:{p256dh:"BASE64URL_PUBLIC_KEY",auth:"BASE64URL_AUTH_SECRET"}}) },
  { tag: "Уведомления", method: "DELETE", path: "/api/work/push", title: "Отключить устройство", description: "Удаляет только собственную подписку с указанным endpoint. Браузер также вызывает PushSubscription.unsubscribe().", scope: "Только сессия браузера", auth:"session", body:jsonBody({endpoint:"https://fcm.googleapis.com/fcm/send/DEVICE_ENDPOINT"}) },
  { tag: "Проекты", method: "GET", path: "/api/projects", title: "Список проектов и корзина", description: "Фильтрует по фактическим правам. Для корзины требуется project.delete.", scope: "projects:read", query: [{ name: "status", example: "active", description: "active, archived или deleted" }] },
  { tag: "Проекты", method: "PATCH", path: "/api/projects/{projectId}", title: "Изменить проект", description: "Меняет параметры проекта. Перенос в группу требует project.group.manage, смена процесса — project.admin и совместимые коды этапов.", scope: "projects:write", permission: "project.edit", body: jsonBody({ name: "Обновлённый проект", target_date: "2026-12-20" }) },
  { tag: "Проекты", method: "DELETE", path: "/api/projects/{projectId}", title: "В корзину", description: "Закрывает доступ к проекту и отменяет незавершённые запросы ИИ. Данные сохраняются для восстановления.", scope: "projects:write", permission: "project.delete", body: jsonBody({ confirmation: "PROD" }) },
  { tag: "Проекты", method: "POST", path: "/api/projects/{projectId}/archive", title: "Архивировать или вернуть в работу", description: "archived=false возвращает проект из архива.", scope: "projects:write", permission: "project.archive", body: jsonBody({ archived: true }) },
  { tag: "Проекты", method: "POST", path: "/api/projects/{projectId}/restore", title: "Восстановить из корзины", description: "Возвращает проект, сохраняя его статус active или archived.", scope: "projects:write", permission: "project.delete", body: jsonBody({}) },
  { tag: "Проекты", method: "GET", path: "/api/projects/{projectId}/access", title: "Доступ пользователей и групп", description: "Прямые назначения, группы и роли, которые вызывающий пользователь вправе назначить.", scope: "projects:read", permission: "project.access.manage" },
  { tag: "Проекты", method: "POST", path: "/api/projects/{projectId}/access", title: "Назначить проектную роль", description: "principal_type: user или group; project_role: manager, member, viewer. Нельзя выдать отсутствующие у себя права или понизить последнего руководителя.", scope: "projects:write", permission: "project.access.manage", body: jsonBody({ principal_type: "group", principal_id: 3, project_role: "member" }) },
  { tag: "Проекты", method: "GET", path: "/api/projects/{projectId}/access/effective", title: "Проверить права сотрудника", description: "Фактические разрешения с учётом групп и явных запретов.", scope: "projects:read", permission: "project.access.manage", query: [{ name: "user_id", required: true, example: "5" }] },
  ...["user", "group"].map((type) => ({ tag: "Проекты", method: "DELETE", path: `/api/projects/{projectId}/access/${type}/{principalId}`, title: `Удалить назначение ${type === "user" ? "пользователя" : "группы"}`, description: "Убирает один источник доступа; другие роли и группы могут сохранить права.", scope: "projects:write", permission: "project.access.manage" })),
  ...[["projects", "projectId", "ai.project.analyze"], ["conferences", "conferenceId", "ai.conference.summarize"]].flatMap(([source, key, permission]) => [
    { tag: "ИИ", method: "GET", path: `/api/${source}/{${key}}/ai`, title: "Сохранённые результаты и модели", description: "Последние 20 запросов, доступные модели и записи встречи. Для результатов по записи дополнительно требуется conference.recording.view.", scope: "ai:read", permission: "ai.result.view или право запуска", query: [{ name: "join_code", description: "UUID ссылки для конференции" }] },
    { tag: "ИИ", method: "POST", path: `/api/${source}/{${key}}/ai`, title: source === "projects" ? "Оценить проект" : "Изложить встречу", description: "202: фоновая обработка. request_id обеспечивает повторяемость; тот же контекст использует кэш. recording_id выбирает готовую расшифровку, без него анализируется чат. regenerate=true создаёт новый результат.", scope: "ai:write", permission, body: jsonBody({ request_id: "8435b65a-7d4c-41aa-9aba-8c6a503f9195", instructions: "Решения, риски и следующие шаги", ...(source === "conferences" ? { recording_id: 12 } : {}) }) },
  ]),
  { tag: "ИИ", method: "GET", path: "/api/ai/jobs/{jobId}", title: "Результат и статус ИИ", description: "queued, running, completed, failed или cancelled. Все права проверяются заново.", scope: "ai:read", permission: "ai.result.view или право запуска", query: [{ name: "join_code", description: "UUID ссылки на встречу" }] },
  { tag: "Записи встреч", method: "GET", path: "/api/conferences/{conferenceId}/recordings", title: "Записи и индикатор", description: "Участникам виден индикатор текущей записи. Для списка файлов требуется conference.recording.view.", scope: "conference:read", query: [{ name: "join_code", description: "UUID ссылки на встречу" }] },
  { tag: "Записи встреч", method: "POST", path: "/api/conferences/{conferenceId}/recordings", title: "Начать запись", description: "Не более одной активной записи встречи. Требуется запущенная комната. MP4 сохраняется в приватный S3. Повтор request_id не запускает второй Egress.", scope: "conference:write", permission: "conference.record", body: jsonBody({ request_id: "dad3c9e6-dfa3-45cd-9473-a591623b659c" }) },
  { tag: "Записи встреч", method: "POST", path: "/api/conferences/{conferenceId}/recordings/{recordingId}/stop", title: "Остановить запись", description: "Сохраняет намерение остановки; worker повторяет его при сбоях. Готовность файла проверяется в S3.", scope: "conference:write", permission: "conference.record", body: jsonBody({}) },
  { tag: "Записи встреч", method: "GET", path: "/api/conferences/{conferenceId}/recordings/{recordingId}/file", title: "Смотреть или скачать MP4", description: "Защищённый поток через приложение с поддержкой одного HTTP Range. download=1 включает загрузку файла.", scope: "conference:read", permission: "conference.recording.view", responseContentType: "video/mp4", query: [{ name: "download", example: "1" }, { name: "join_code" }] },
  { tag: "Записи встреч", method: "POST", path: "/api/conferences/{conferenceId}/recordings/{recordingId}/transcribe", title: "Расшифровать запись", description: "Постановка в отдельную очередь; готовая расшифровка общая. Ошибка возобновляется с сохранённых фрагментов при неизменной конфигурации распознавания.", scope: "ai:write", permission: "ai.conference.summarize + conference.recording.view", body: jsonBody({}) },
  { tag: "Записи встреч", method: "GET", path: "/api/conferences/{conferenceId}/recordings/{recordingId}/transcript", title: "Скачать расшифровку", description: "Полный UTF-8 текст с временем начала каждого десятиминутного фрагмента.", scope: "conference:read", permission: "conference.recording.view", responseContentType: "text/plain", query: [{ name: "join_code" }] },

  {
    tag: "Задачи",
    method: "GET",
    path: "/api/search",
    title: "Поиск задач",
    description: "Выполняет поиск по языку запросов Контур с пагинацией и проверкой доступа к проектам.",
    scope: "tasks:read",
    query: [{ name: "q", required: true, example: "assignee = currentUser()" }, { name: "limit", example: "100" }, { name: "offset", example: "0" }],
  },
  { tag: "Задачи", method: "GET", path: "/api/tasks/{taskId}/details", title: "Карточка задачи", description: "Возвращает задачу, атрибуты, связи, комментарии и доступные действия.", scope: "tasks:read", permission: "project.browse" },
  { tag: "Задачи", method: "POST", path: "/api/tasks", title: "Создать задачу", description: "Создаёт задачу в выбранном проекте.", scope: "tasks:write", permission: "task.create", body: jsonBody({ project_id: 1, stage_id: 1, title: "Подготовить релиз", priority: "high" }) },
  { tag: "Задачи", method: "PATCH", path: "/api/tasks/{taskId}", title: "Изменить задачу", description: "Частично обновляет поля задачи.", scope: "tasks:write", permission: "task.edit", body: jsonBody({ progress: 80, priority: "high" }) },
  { tag: "Проекты", method: "GET", path: "/api/projects/{projectId}", title: "Данные проекта", description: "Возвращает проект и доступные сущности планирования.", scope: "projects:read", permission: "project.browse" },
  { tag: "Проекты", method: "POST", path: "/api/projects", title: "Создать проект", description: "Создаёт проект из пустой конфигурации или шаблона.", scope: "projects:write", permission: "project.create", body: jsonBody({ name: "Новый продукт", key_code: "PROD", description: "Развитие продукта" }) },
  { tag: "Чаты", method: "GET", path: "/api/chat/channels", title: "Список чатов", description: "Возвращает доступные личные, групповые и проектные каналы.", scope: "chat:read", permission: "chat.use" },
  { tag: "Чаты", method: "POST", path: "/api/chat/channels", title: "Создать чат", description: "Создаёт личный, групповой или проектный канал.", scope: "chat:write", permission: "chat.use", body: jsonBody({ project_id: 1, channel_type: "project", name: "Команда проекта", member_ids: [2, 3] }) },
  { tag: "Чаты", method: "GET", path: "/api/chat/channels/{channelId}/messages", title: "Получить сообщения", description: "Без курсора: последние 100 сообщений в хронологическом порядке. after=ID — следующие 100, before=ID — предыдущие 100. Курсоры несовместимы. mark_read=false отключает автоматическую отметку прочтения; интерфейс подтверждает прочтение отдельным POST /read.", scope: "chat:read", permission: "chat.use", query: [{ name: "after", example: "100" }, { name: "before", example: "50" }, { name: "mark_read", example: "false" }] },
  { tag: "Чаты", method: "POST", path: "/api/chat/channels/{channelId}/messages", title: "Отправить сообщение", description: "Отправляет текстовое сообщение или ответ в канал.", scope: "chat:write", permission: "chat.use", body: jsonBody({ body: "Статус обновлён", reply_to_id: null }) },
  { tag: "Чаты", method: "GET", path: "/api/chat/presence", title: "Статусы сотрудников", description: "Возвращает текущую доступность сотрудников рабочего пространства.", scope: "chat:read" },
  { tag: "Чаты", method: "POST", path: "/api/chat/presence", title: "Обновить свой статус", description: "Обновляет online/away и время последней активности.", scope: "chat:write", body: jsonBody({ state: "online" }) },
  { tag: "Файлы чата", method: "POST", path: "/api/chat/channels/{channelId}/attachments/presign", title: "Получить URL загрузки", description: "Создаёт временный URL для прямой загрузки файла в объектное хранилище.", scope: "chat:write", permission: "chat.use", body: jsonBody({ file_name: "макет.pdf", mime_type: "application/pdf", size_bytes: 1048576 }) },
  { tag: "Файлы чата", method: "POST", path: "/api/chat/channels/{channelId}/attachments/complete", title: "Завершить загрузку", description: "Проверяет объект и публикует файловое сообщение.", scope: "chat:write", permission: "chat.use", body: jsonBody({ object_key: "workspaces/1/chat/1/id-file.pdf", file_name: "макет.pdf", mime_type: "application/pdf" }) },
  { tag: "Конференции", method: "GET", path: "/api/conferences", title: "Список конференций", query: [{ name: "history", example: "true" }], description: "Возвращает доступные встречи за последние 7 дней и будущие. history=true включает всю историю; доступны встречи организатора, приглашённого участника или модератора.", scope: "conference:read" },
  { tag: "Конференции", method: "GET", path: "/api/conferences/join/{joinCode}", title: "Открыть встречу по ссылке", description: "Проверяет код подключения и возвращает конференцию. Для открытой встречи приглашение не требуется.", scope: "conference:read" },
  { tag: "Конференции", method: "POST", path: "/api/conferences", title: "Создать или начать конференцию", description: "Создаёт интерактивную встречу или вебинар без искусственного лимита подключений. start_now запускает встречу немедленно.", scope: "conference:write", permission: "conference.create", body: jsonBody({ project_id: 1, title: "Демо спринта", scheduled_start: "2026-09-10T10:00:00.000Z", scheduled_end: "2026-09-10T11:00:00.000Z", conference_mode: "interactive", start_now: false, participant_ids: [2, 3], presenter_ids: [2] }) },
  { tag: "Конференции", method: "PATCH", path: "/api/conferences/{conferenceId}", title: "Изменить конференцию", description: "Обновляет время, формат, участников и статус встречи.", scope: "conference:write", permission: "conference.manage", body: jsonBody({ status: "live", participant_ids: [2, 3] }) },
  { tag: "Конференции", method: "POST", path: "/api/conferences/{conferenceId}/token", title: "Получить медиатокен", description: "Выдаёт короткоживущий LiveKit-токен с ролью участника или ведущего. Для входа без приглашения передайте код из ссылки.", scope: "conference:write", body: jsonBody({ join_code: "04bb661f-5fc8-42e8-89cd-c84d9e39da42" }) },
  { tag: "Конференции", method: "GET", path: "/api/conferences/{conferenceId}/messages", title: "История чата конференции", description: "По умолчанию возвращает последние 100 сообщений по возрастанию ID. after=0 начинает историю с начала, after=ID получает новые записи, before=ID — предыдущие. after и before несовместимы; limit от 1 до 250. Доступ: организатор, приглашение, действующая ссылка или conference.manage.", scope: "conference:read", query: [{ name: "after", example: "0" }, { name: "before", description: "ID для старых сообщений; несовместим с after" }, { name: "limit", example: "250" }, { name: "join_code", example: "04bb661f-5fc8-42e8-89cd-c84d9e39da42" }] },
  { tag: "Конференции", method: "GET", path: "/api/conferences/{conferenceId}/transcript", title: "Скачать полный чат", description: "Выгружает весь чат и вопросы до начала запроса потоком UTF-8 TXT с датами в UTC, авторами и статусами вопросов. Доступ сохраняется после завершения встречи. Организатор, приглашение, действующая ссылка или conference.manage.", scope: "conference:read", responseContentType: "text/plain", query: [{ name: "join_code", example: "04bb661f-5fc8-42e8-89cd-c84d9e39da42" }] },
  { tag: "Конференции", method: "POST", path: "/api/conferences/{conferenceId}/messages", title: "Написать в чат или задать вопрос", description: "Сохраняет сообщение либо вопрос. client_id — UUID попытки отправки: повтор с тем же UUID и содержимым возвращает ту же запись; другое содержимое даёт 409. После завершения встречи запись запрещена (409). Доступ: организатор, приглашение, действующая ссылка или conference.manage.", scope: "conference:write", body: jsonBody({ body: "Когда будет доступна новая версия?", message_type: "question", client_id: "ed45e83e-49d7-4a65-81f4-35cf6ab398f9", join_code: "04bb661f-5fc8-42e8-89cd-c84d9e39da42" }) },
  { tag: "Конференции", method: "GET", path: "/api/conferences/{conferenceId}/questions", title: "Очередь вопросов", description: "Возвращает вопросы со статусами open, answered, dismissed. Сначала открытые, затем остальные; внутри группы по ID. limit: 1–250, offset: от 0. Доступ: организатор, приглашение, действующая ссылка или conference.manage.", scope: "conference:read", query: [{ name: "limit", example: "100" }, { name: "offset", example: "0" }, { name: "join_code", example: "04bb661f-5fc8-42e8-89cd-c84d9e39da42" }] },
  { tag: "Конференции", method: "PATCH", path: "/api/conferences/{conferenceId}/questions/{messageId}", title: "Обработать вопрос", description: "Помечает вопрос отвеченным, закрытым или снова открытым.", scope: "conference:write", permission: "conference.manage", body: jsonBody({ status: "answered" }) },
  { tag: "Конференции", method: "GET", path: "/api/conferences/{conferenceId}/participants", title: "Участники и поднятые руки", description: "Возвращает участников, роли и очередь поднятых рук с поиском по имени. limit: 1–500, offset: от 0. Ответ содержит total, matching_count, raised_count и own_hand_raised_at независимо от страницы и фильтра. Доступ: организатор, приглашение, действующая ссылка или conference.manage.", scope: "conference:read", query: [{ name: "offset", example: "0" }, { name: "q", example: "Анна" }, { name: "limit", example: "250" }, { name: "join_code", example: "04bb661f-5fc8-42e8-89cd-c84d9e39da42" }] },
  { tag: "Конференции", method: "POST", path: "/api/conferences/{conferenceId}/hand", title: "Поднять или опустить свою руку", description: "Изменяет состояние своей руки и сохраняет время первого поднятия; повтор не меняет место в очереди. Доступ: организатор, приглашение, действующая ссылка или conference.manage. После завершения встречи возвращает 409.", scope: "conference:write", body: jsonBody({ raised: true, join_code: "04bb661f-5fc8-42e8-89cd-c84d9e39da42" }) },
  { tag: "Конференции", method: "PATCH", path: "/api/conferences/{conferenceId}/participants/{userId}", title: "Опустить руку участника", description: "Позволяет организатору или модератору опустить руку выбранного участника.", scope: "conference:write", permission: "conference.manage", body: jsonBody({ raised: false }) },
  { tag: "База знаний", method: "GET", path: "/api/knowledge/teams", title: "Список команд", description: "Возвращает доступные пользователю команды и его роль в каждой из них.", scope: "knowledge:read" },
  { tag: "База знаний", method: "POST", path: "/api/knowledge/teams", title: "Создать команду", description: "Создаёт команду базы знаний и назначает участников и руководителей.", scope: "knowledge:write", permission: "knowledge.manage", body: jsonBody({ name: "Архитектура", slug: "architecture", member_ids: [2, 3], lead_ids: [2] }) },
  { tag: "База знаний", method: "PATCH", path: "/api/knowledge/teams/{teamId}", title: "Изменить команду", description: "Обновляет состав команды и роли руководителей.", scope: "knowledge:write", body: jsonBody({ member_ids: [2, 3, 4], lead_ids: [2] }) },
  { tag: "База знаний", method: "GET", path: "/api/knowledge/spaces", title: "Список пространств", description: "Возвращает только доступные пространства вместе с вычисленным уровнем ACL.", scope: "knowledge:read" },
  { tag: "База знаний", method: "POST", path: "/api/knowledge/spaces", title: "Создать пространство", description: "Создаёт отдельное пространство знаний с командой-владельцем и режимом видимости.", scope: "knowledge:write", body: jsonBody({ name: "Архитектура", slug: "architecture", visibility: "restricted", owner_team_id: 1 }) },
  { tag: "База знаний", method: "PATCH", path: "/api/knowledge/spaces/{spaceId}", title: "Изменить пространство", description: "Обновляет название, видимость и команду-владельца пространства.", scope: "knowledge:write", body: jsonBody({ visibility: "restricted", owner_team_id: 1 }) },
  { tag: "База знаний", method: "PUT", path: "/api/knowledge/spaces/{spaceId}/permissions", title: "Настроить права пространства", description: "Заменяет ACL пользователей и команд для выбранного пространства.", scope: "knowledge:write", body: jsonBody({ permissions: [{ principal_type: "team", principal_id: 1, access_level: "edit" }, { principal_type: "user", principal_id: 4, access_level: "view" }] }) },
  { tag: "База знаний", method: "GET", path: "/api/knowledge/spaces/{spaceId}/permissions", title: "Права пространства", description: "Возвращает ACL пространства пользователю с уровнем admin.", scope: "knowledge:read" },
  { tag: "База знаний", method: "GET", path: "/api/knowledge/articles/{articleId}", title: "Получить статью", description: "Возвращает статью после проверки права пространства; черновики доступны редакторам.", scope: "knowledge:read" },
  { tag: "База знаний", method: "POST", path: "/api/knowledge/articles", title: "Создать статью", description: "Создаёт статью в пространстве, где пользователь имеет уровень edit или admin.", scope: "knowledge:write", body: jsonBody({ space_id: 1, title: "Архитектурное решение", slug: "architecture-decision", body: "# Решение", status: "draft" }) },
  { tag: "База знаний", method: "PATCH", path: "/api/knowledge/articles/{articleId}", title: "Изменить статью", description: "Создаёт новую версию содержимого статьи в доступном пространстве.", scope: "knowledge:write", body: jsonBody({ body: "# Обновлённое решение", status: "draft", version_number: 3 }) },
  { tag: "Телефония", method: "GET", path: "/api/telephony/status", title: "Состояние телефонии", description: "Показывает готовность шлюза и маскированный исходящий номер без раскрытия секретов.", scope: "telephony:read" },
  { tag: "Телефония", method: "GET", path: "/api/telephony/calls", title: "Журнал звонков", description: "Возвращает звонки проекта с фильтрацией по статусу.", scope: "telephony:read", permission: "telephony.view", query: [{ name: "projectId", required: true, example: "1" }, { name: "status", example: "completed" }, { name: "limit", example: "50" }, { name: "offset", example: "0" }] },
  { tag: "Телефония", method: "GET", path: "/api/telephony/calls/{callId}", title: "Данные звонка", description: "Возвращает состояние и привязки одного звонка.", scope: "telephony:read", permission: "telephony.view" },
  { tag: "Телефония", method: "POST", path: "/api/telephony/calls", title: "Начать исходящий звонок", description: "Создаёт звонок через настроенный телефонный шлюз и связывает его с проектом, задачей или конференцией.", scope: "telephony:write", permission: "telephony.call", body: jsonBody({ project_id: 1, to_number: "+74951234567", task_id: 42, record: false }) },
  { tag: "Телефония", method: "POST", path: "/api/telephony/calls/{callId}/hangup", title: "Завершить звонок", description: "Отправляет в шлюз команду завершения активного звонка.", scope: "telephony:write", permission: "telephony.call", body: jsonBody({}) },
];

const TAG_DESCRIPTIONS = {
  "Тестирование": "Тест-кейсы, планы и ручные или автоматические прогоны",
  "Цели и OKR": "Цели проектов и измеримые результаты",
  "Эксплуатация": "Инфраструктура и метрики платформы",
  ...Object.fromEntries([...new Set(WORK_API_ENDPOINTS.map(e => e.tag))].map(tag => [tag, tag])),
  "ИИ": "Оценки проектов и изложения встреч по чату или записи",
  "Записи встреч": "Опциональная запись, приватный S3 и кэшируемая расшифровка",
  "Задачи": "Задачи, поиск и карточки",
  "Проекты": "Проекты и планирование",
  "Чаты": "Каналы, сообщения и присутствие",
  "Файлы чата": "Безопасная загрузка вложений",
  "Конференции": "Планирование, LiveKit, постоянный чат, вопросы и модерация",
  "База знаний": "Команды, пространства и адресные права доступа",
  "Телефония": "Исходящие звонки через внешний шлюз",
};

function operationFor(endpoint) {
  const parameters = [
    ...(endpoint.path.match(/\{[^}]+\}/g) || []).map((token) => ({
      name: token.slice(1, -1),
      in: "path",
      required: true,
      schema: (token.toLowerCase().includes("code") || token === "{blockId}")
        ? { type: "string", format: "uuid" }
        : { type: "integer", minimum: 1 },
    })),
    ...(endpoint.query || []).map((query) => ({
      name: query.name,
      in: "query",
      required: Boolean(query.required),
      schema: { type: ["limit", "offset", "after", "before"].includes(query.name) ? "integer" : query.name === "history" ? "boolean" : "string" },
      ...(query.description ? { description: query.description } : {}),
      ...(query.example !== undefined ? { example: ["limit", "offset", "after", "before"].includes(query.name) ? Number(query.example) : query.name === "history" ? query.example === "true" : query.example } : {}),
    })),
  ];
  return {
    tags: [endpoint.tag],
    summary: endpoint.title,
    description: `${endpoint.description}\n\nAPI scope: \`${endpoint.scope}\`${endpoint.permission ? `; функциональное разрешение: \`${endpoint.permission}\`` : ""}.`,
    operationId: `${endpoint.method.toLowerCase()}_${endpoint.path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    security: endpoint.auth === "session" ? [{ sessionCookie: [] }] : [{ bearerAuth: [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(endpoint.body ? { requestBody: { required: true, content: { [endpoint.body.contentType]: { schema: endpoint.body.binary ? {type: "string", format: "binary"} : { type: Array.isArray(endpoint.body.example) ? "array" : "object", ...(Array.isArray(endpoint.body.example) ? { items: { type: "object" } } : {}) }, example: endpoint.body.example } } } } : {}),
    responses: {
      200: { description: "Успешный ответ", content: { [endpoint.responseContentType || "application/json"]: { schema: endpoint.responseContentType === "text/plain" ? { type: "string" } : {} } } },
      201: { description: "Объект создан", content: { "application/json": { schema: {} } } },
      202: { description: "Фоновая обработка принята" },
      206: { description: "Часть видеофайла по HTTP Range" },
      416: { description: "Некорректный диапазон файла" },
      429: { description: "Превышен лимит запросов или фоновых задач" },
      503: { description: "Компонент инфраструктуры недоступен" },
      401: { $ref: "#/components/responses/Unauthorized" },
      403: { $ref: "#/components/responses/Forbidden" },
      404: { description: "Объект не найден или недоступен" },
      409: { description: "Конфликт состояния или повтор client_id с другим содержимым" },
      422: { $ref: "#/components/responses/ValidationError" },
    },
    "x-kontur-scope": endpoint.scope,
    ...(endpoint.permission ? { "x-kontur-permission": endpoint.permission } : {}),
  };
}

export function buildOpenApiDocument(origin = "https://projects.company.ru") {
  const paths = {};
  for (const endpoint of API_ENDPOINTS) {
    paths[endpoint.path] ||= {};
    paths[endpoint.path][endpoint.method.toLowerCase()] = operationFor(endpoint);
  }
  paths["/api/livekit/webhook"] = {post:{tags:['Конференции'],summary:'Подписанное событие LiveKit',operationId:'post_livekit_webhook',description:'Исходное тело проверяется WebhookReceiver по Authorization JWT и SHA-256. participant_joined, participant_left, room_finished; дедупликация по event.id. До 1 МБ. Настройте доставку в LiveKit.',security:[{livekitWebhook:[]}],requestBody:{required:true,content:{'application/webhook+json':{schema:{type:'object'}}}},responses:{200:{description:'Принято или безопасно проигнорировано'},401:{description:'Недействительная подпись'},413:{description:'Слишком большое событие'}}}};
  paths["/api/telephony/webhook"] = {
    post: {
      tags: ["Телефония"],
      summary: "Статус звонка от телефонного шлюза",
      description: "Callback внешнего шлюза. Подпись — HMAC-SHA256 от исходных байтов JSON с TELEPHONY_WEBHOOK_SECRET.",
      operationId: "post_telephony_webhook",
      security: [{ telephonyWebhook: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", required: ["provider_call_id", "status"] },
            example: { provider_call_id: "provider-id", status: "completed", duration_seconds: 150 },
          },
        },
      },
      responses: { 200: { description: "Статус принят" }, 202: { description: "Неизвестный звонок безопасно проигнорирован" }, 401: { description: "Некорректная HMAC-подпись" } },
    },
  };
  paths["/api/work/development/webhook/{connectionId}"] = {
    post: {
      tags: ["Инструменты данных"], summary: "Событие GitHub или GitLab", operationId: "post_development_webhook",
      description: "Подпись GitHub проверяется по исходным байтам тела (HMAC-SHA256). GitLab передаёт секрет в X-Gitlab-Token. Provider выбирается при создании подключения. Авторизация персональным токеном здесь не используется. До 3 МБ; повтор события обновляет существующую связь, не создавая дубль.",
      security: [{ githubWebhook: [] }, { gitlabWebhook: [] }],
      parameters: [{ name: "connectionId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object" }, example: { ref: "refs/heads/NOVA-42", commits: [{ id: "sha", message: "NOVA-42 Исправление", url: "https://github.com/company/project/commit/sha" }] } } } },
      responses: { 200: { description: "Событие обработано" }, 401: { description: "Неверная подпись" }, 404: { description: "Подключение отключено или проект недоступен" }, 413: { description: "Слишком большой запрос" } }
    }
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Контур Work API",
      version: "0.18.0",
      description: "REST API управления проектами, задачами, чатами, конференциями и телефонией. Моменты времени передаются в ISO 8601 UTC, календарные даты — YYYY-MM-DD.",
    },
    servers: [{ url: origin, description: "Текущая установка" }],
    tags: Object.entries(TAG_DESCRIPTIONS).map(([name, description]) => ({ name, description })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "kontur_session", description: "Интерактивная сессия после входа и второго фактора. Персональные API-токены не принимаются." },
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "kw_ personal token", description: "Полный персональный токен из раздела «Мой API»." },
        githubWebhook: { type: "apiKey", in: "header", name: "X-Hub-Signature-256", description: "sha256=<HMAC-SHA256 исходного тела>" },
        gitlabWebhook: { type: "apiKey", in: "header", name: "X-Gitlab-Token", description: "Секрет из настройки подключения" },
        livekitWebhook: {type: 'http', scheme: 'bearer', bearerFormat: 'LiveKit signed webhook JWT', description: 'Служебная подпись LiveKit; персональные токены здесь не принимаются'},
        telephonyWebhook: { type: "apiKey", in: "header", name: "X-Kontur-Telephony-Signature", description: "sha256=<HMAC-SHA256 исходного JSON>" },
      },
      responses: {
        Unauthorized: { description: "Токен отсутствует, отозван или истёк", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Forbidden: { description: "Scope токена, политика пользователя или проектная роль запрещают операцию", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        ValidationError: { description: "Некорректные параметры", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, details: {} } },
      },
    },
  };
}
