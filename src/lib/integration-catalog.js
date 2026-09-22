// Shared presentation data: never put credentials or server configuration here.
export const INTEGRATION_PROVIDERS = [
 {key:'telegram',name:'Telegram',mark:'TG',description:'Уведомления о задачах в группу, канал или тему.',credential:'Токен бота'},
 {key:'mattermost',name:'Mattermost',mark:'MM',description:'События проекта в канале корпоративного мессенджера.',credential:'URL входящего webhook'},
 {key:'slack',name:'Slack',mark:'SL',description:'Сообщения в канал через Incoming Webhook.',credential:'URL входящего webhook'},
 {key:'webhook',name:'Webhook',mark:'{}',description:'Подписанные JSON-события для n8n, Make и собственных сервисов.',credential:'URL получателя'},
];
export const INTEGRATION_EVENTS = [
 {key:'sla.warning',name:'Предупреждение SLA'}, {key:'sla.breached',name:'Нарушение SLA'}, {key:'sla.escalated',name:'Эскалация SLA'},
 {key:'task.created',name:'Создана задача'}, {key:'task.updated',name:'Задача изменена'},
 {key:'task.due_soon',name:'Приближается срок'}, {key:'comment.created',name:'Добавлен комментарий'},
];
export const DELIVERY_STATES = {pending:'В очереди',running:'Отправляется',delivered:'Доставлено',failed:'Ошибка',cancelled:'Отменено'};
export const DELIVERY_ERRORS = {HTTP_ERROR:'Сервис отклонил запрос',RATE_LIMIT:'Лимит запросов сервиса',NETWORK_ERROR:'Ошибка сети или TLS',TIMEOUT:'Истекло время ожидания',ADDRESS_BLOCKED:'Адрес запрещён сетевой политикой',INVALID_RESPONSE:'Некорректный ответ сервиса',RESPONSE_TOO_LARGE:'Слишком большой ответ',ACCESS_REVOKED:'Права редактора или инициатора отозваны',CONNECTION_CHANGED:'Подключение изменено или отключено',TASK_UNAVAILABLE:'Задача удалена или перемещена',WORKER_INTERRUPTED:'Обработка была прервана',CONFIG_INVALID:'Проверьте сохранённые реквизиты'};
