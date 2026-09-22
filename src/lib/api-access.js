import { one, parseJson } from "./db.js";

export const API_SCOPE_CATALOG = [
  { key: "agents:identities", name: "Учётные записи агентов", mode: "Изменение" },
  { key: "agents:read", name: "Агенты и журнал запусков", mode: "Чтение" },
  { key: "agents:write", name: "Настройка агентов", mode: "Изменение" },
  { key: "agents:run", name: "Запуск агентов и сбор данных", mode: "Изменение" },
  { key: "agents:approve", name: "Подтверждение действий агентов", mode: "Изменение" },

  { key: "operations:read", name: "Состояние инфраструктуры и метрики", mode: "Чтение" },
  { key: "imports:read", name: "Предварительный просмотр и сверка импорта", mode: "Чтение" },
  { key: "imports:write", name: "Импорт Jira, загрузка файлов и возобновление", mode: "Изменение" },
  { key: "semantic:read", name: "Семантический поиск и состояние индекса", mode: "Чтение" },
  { key: "semantic:write", name: "Запуск и остановка индексации", mode: "Изменение" },
  { key: "quality:read", name: "Тест-кейсы, планы и прогоны", mode: "Чтение" },
  { key: "quality:write", name: "Управление тестированием и запись результатов", mode: "Изменение" },
  { key: "objectives:read", name: "Цели и ключевые результаты", mode: "Чтение" },
  { key: "objectives:write", name: "Настройка целей и обновление результатов", mode: "Изменение" },
  { key: "sync:read", name: "Подключения синхронизации и конфликты", mode: "Чтение" },
  { key: "sync:write", name: "Настройка синхронизации, календарей и разрешение конфликтов", mode: "Изменение" },
  { key: "integrations:read", name: "Подключения и журнал доставки", mode: "Чтение" },
  { key: "integrations:write", name: "Настройка подключений", mode: "Изменение" },
  { key: "integrations:send", name: "Тестовая и повторная отправка интеграций", mode: "Изменение" },
  { key: "automation:read", name: "Правила и журнал автоматизаций", mode: "Чтение" },
  { key: "automation:write", name: "Создание и изменение автоматизаций", mode: "Изменение" },
  { key: "workspace:read", name: "Общие данные рабочего пространства", mode: "Чтение" },
  { key: "projects:read", name: "Проекты, этапы и планирование", mode: "Чтение" },
  { key: "projects:write", name: "Проекты, спринты и релизы", mode: "Изменение" },
  { key: "tasks:read", name: "Задачи, поиск и вложения", mode: "Чтение" },
  { key: "tasks:write", name: "Задачи, комментарии и трудозатраты", mode: "Изменение" },
  { key: "reports:read", name: "Отчёты и аналитика", mode: "Чтение" },
  { key: "knowledge:read", name: "База знаний", mode: "Чтение" },
  { key: "knowledge:write", name: "База знаний", mode: "Изменение" },
  { key: "profile:read", name: "Собственный профиль и уведомления", mode: "Чтение" },
  { key: "profile:write", name: "Собственные настройки и фильтры", mode: "Изменение" },
  { key: "chat:read", name: "Чаты, сообщения и присутствие", mode: "Чтение" },
  { key: "chat:write", name: "Чаты, сообщения и файлы", mode: "Изменение" },
  { key: "conference:read", name: "Конференции и участники", mode: "Чтение" },
  { key: "conference:write", name: "Планирование и управление конференциями", mode: "Изменение" },
  { key: "ai:read", name: "Просмотр результатов ИИ", mode: "Чтение" },
  { key: "ai:write", name: "Запуск анализа и сводок ИИ", mode: "Изменение" },
  { key: "telephony:read", name: "Состояние и журнал телефонии", mode: "Чтение" },
  { key: "telephony:write", name: "Исходящие звонки и управление ими", mode: "Изменение" },
];

export const DEFAULT_API_SCOPES = API_SCOPE_CATALOG.filter((item) => !["agents:identities", "agents:read", "agents:write", "agents:run", "agents:approve", "operations:read", "imports:read", "imports:write", "semantic:read", "semantic:write", "quality:read", "quality:write", "objectives:read", "objectives:write", "sync:read", "sync:write", "integrations:read", "integrations:write", "integrations:send", "automation:read", "automation:write", "projects:write", "knowledge:write", "telephony:write", "ai:read", "ai:write"].includes(item.key)).map((item) => item.key);

export function apiScopes(value) {
  const stored = parseJson(value, []);
  const expanded = [...stored];
  if (stored.includes("collaboration:read")) expanded.push("chat:read", "conference:read");
  if (stored.includes("collaboration:write")) expanded.push("chat:write", "conference:write");
  if (stored.includes("read") || stored.includes("*")) expanded.push(...API_SCOPE_CATALOG.filter((item) => item.mode === "Чтение").map((item) => item.key));
  if (stored.includes("write") || stored.includes("*")) expanded.push(...API_SCOPE_CATALOG.filter((item) => item.mode === "Изменение").map((item) => item.key));
  return [...new Set(expanded.filter((scope) => API_SCOPE_CATALOG.some((item) => item.key === scope)))];
}

function routeScope(request) {
  const parts = new URL(request.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const root = parts[0] || "";
  const read = ["GET", "HEAD"].includes(request.method);
  if (root === "work") {
    const module = parts[1];
    if (module === "push") return null;
    if (module === "operations") return read ? "operations:read" : null;
    if (module === "jira-imports") return parts[2] === "task" ? "tasks:read" : read ? "imports:read" : "imports:write";
    if (module === "semantic") return parts[2] === "settings" ? null : parts[2] === "search" || read ? "semantic:read" : "semantic:write";
    if (module === "agents" && parts[2] === "identities") return "agents:identities";
    if (module === "agents" && parts[3] === "evaluations") return read ? "agents:read" : parts[4] === "suites" ? "agents:write" : "agents:run";
    if (module === "agents") return read ? "agents:read" : ["preview","run","test","cancel","feedback"].includes(parts.at(-1)) ? "agents:run" : ["review","gate"].includes(parts.at(-1)) ? "agents:approve" : "agents:write";
    if (module === "allure") return read ? "quality:read" : "quality:write";
    if (module === "quality") return read ? "quality:read" : "quality:write";
    if (module === "objectives") return read ? "objectives:read" : "objectives:write";
    if (["sync","sync-meetings"].includes(module)) return read ? "sync:read" : "sync:write";
    if (module === "integrations") return read ? "integrations:read" : ["test","retry"].includes(parts.at(-1)) ? "integrations:send" : "integrations:write";
    if (["conference-tools","conference-captions"].includes(module)) return read ? "conference:read" : "conference:write";
    if (module === "task-ai") return "ai:write";
    if (module === "ai-usage") return "ai:read";
    if (module === "leveling") return "reports:read";
    if (module === "analytics") return parts[2] === "subscriptions" ? (read ? "profile:read" : "profile:write") : parts[2] === "groups" ? "profile:read" : "reports:read";
    if (module === "views") return read ? "profile:read" : "profile:write";
    if (["task-changes","undo"].includes(module)) return "tasks:write";
    if (module === "sla") return ["calendars","notifications"].includes(parts[2]) ? null : "tasks:read";
    if (["security","directory"].includes(module)) return null;
    if (module === "automations") return read ? "automation:read" : "automation:write";
    if (["ai-search", "meeting-actions"].includes(module)) return read ? "ai:read" : "ai:write";
    if (module === "knowledge") return read ? "knowledge:read" : "knowledge:write";
    if (["recordings", "meetings"].includes(module)) return read ? "conference:read" : "conference:write";
    if (module === "preferences") return read ? "profile:read" : "profile:write";
    if (["offline", "bulk", "imports", "approvals"].includes(module)) return read ? "tasks:read" : "tasks:write";
    return read ? "projects:read" : "projects:write";
  }
  if (root === "admin" || root === "tokens") return null;
  if (root === "bootstrap") return null;
  if (root === "conferences" && parts[2] === "recordings" && parts[4] === "transcribe") return "ai:write";
  if (root === "ai" || (["projects", "conferences"].includes(root) && parts[2] === "ai")) return read ? "ai:read" : "ai:write";
  if (["search", "tasks", "attachments"].includes(root)) return read ? "tasks:read" : "tasks:write";
  if (["comments", "checklist", "worklogs", "watchers"].includes(root)) return read ? "tasks:read" : "tasks:write";
  if (["projects", "groups", "sprints", "releases"].includes(root)) return read ? "projects:read" : "projects:write";
  if (root === "reports") return "reports:read";
  if (root === "knowledge") return read ? "knowledge:read" : "knowledge:write";
  if (["notifications", "filters", "dashboards"].includes(root)) return read ? "profile:read" : "profile:write";
  if (root === "chat") return read ? "chat:read" : "chat:write";
  if (root === "conferences") return read ? "conference:read" : "conference:write";
  if (root === "telephony") return read ? "telephony:read" : "telephony:write";
  return read ? "workspace:read" : null;
}

export function apiRequestError(user, request) {
  if (!user?.api_token_id) return null;
  if (!user.api_enabled) return "Доступ пользователя к API отключён администратором";
  const required = routeScope(request);
  if (!required) return "Этот маршрут недоступен по персональному API-токену";
  const tokenScopes = apiScopes(user.scopes_json);
  const allowedScopes = apiScopes(user.allowed_scopes_json);
  if (!tokenScopes.includes(required)) return `API-токен не имеет разрешения «${required}»`;
  if (!allowedScopes.includes(required)) return `Разрешение «${required}» отключено в политике пользователя`;
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const additional = parts[1] === "work" && parts[2] === "task-ai" ? ["tasks:read"] : parts[1] === "work" && parts[2] === "conference-captions" && parts[4] === "chunks" ? ["ai:write"] : parts[1] === "work" && parts[2] === "portfolio" && parts[3] === "dependencies" && !["GET", "HEAD"].includes(request.method) ? ["tasks:write"] : parts[1] === "work" && parts[2] === "meeting-actions" && request.method === "PATCH" ? ["tasks:write"] : parts[1] === "work" && parts[2] === "meeting-actions" && parts[4] === "publish" ? ["knowledge:write"] : parts[1] === "work" && parts[2] === "ai-search" ? ["tasks:read", "knowledge:read", "conference:read"] : [];
  for (const scope of additional) if (!tokenScopes.includes(scope) || !allowedScopes.includes(scope)) return `Для этого действия дополнительно требуется scope «${scope}»`;
  return null;
}

export async function apiBackgroundAllowed(user, tokenId, scope) {
  if (!tokenId) return true;
  const token = await one(`SELECT token.scopes_json, policy.allowed_scopes_json, policy.enabled FROM api_tokens token
    JOIN user_api_access policy ON policy.user_id=token.user_id
    WHERE token.id=? AND token.user_id=? AND token.workspace_id=? AND token.revoked_at IS NULL
      AND (token.expires_at IS NULL OR token.expires_at>CURRENT_TIMESTAMP)`, [tokenId, user.id, user.workspace_id]);
  return Boolean(token?.enabled && apiScopes(token.scopes_json).includes(scope) && apiScopes(token.allowed_scopes_json).includes(scope));
}
