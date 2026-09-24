import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];

async function text(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function fail(message) {
  failures.push(message);
}

function stripCssLiterals(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
}

const cssFiles = ["app/globals.css", "app/advanced.css", "app/polish.css", "app/ai-tools.css", "app/workbench.css", "app/brand.css", "app/workspace.css", "app/agents.css", "app/studio.css"];
let cssRuleCount = 0;

for (const file of cssFiles) {
  const source = await text(file);
  const normalized = stripCssLiterals(source);
  const opens = (normalized.match(/{/g) || []).length;
  const closes = (normalized.match(/}/g) || []).length;
  if (opens !== closes) fail(`${file}: несбалансированные CSS-блоки (${opens}/${closes})`);
  cssRuleCount += opens;

  for (const match of normalized.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
    const size = Number(match[1]);
    if (size > 0 && size < 12) fail(`${file}: найден нечитаемый размер шрифта ${size}px`);
  }
  for (const match of normalized.matchAll(/font:\s*(\d+(?:\.\d+)?)px(?:\/|\s)/g)) {
    const size = Number(match[1]);
    if (size > 0 && size < 12) fail(`${file}: найден нечитаемый shorthand-шрифт ${size}px`);
  }
}

const packageJson = JSON.parse(await text("package.json"));
const packageLock = JSON.parse(await text("package-lock.json"));
if (packageJson.version !== packageLock.version) fail("Версии package.json и package-lock.json различаются");
if (packageJson.version !== packageLock.packages?.[""]?.version) fail("Версия корневого пакета в lock-файле устарела");

const layout = await text("app/layout.jsx");
const globalsPosition = layout.indexOf('import "./globals.css"');
const polishPosition = layout.indexOf('import "./polish.css"');
if (globalsPosition < 0 || polishPosition < globalsPosition) fail("Слой визуальной полировки должен подключаться после базовых стилей");

const manifest = JSON.parse(await text("public/manifest.webmanifest"));
if (manifest.lang !== "ru") fail("PWA-манифест должен объявлять русский язык");
if (!["standalone", "fullscreen"].includes(manifest.display)) fail("PWA-манифест не настроен на автономный запуск");
if (!manifest.start_url || !manifest.scope) fail("PWA-манифест не содержит start_url или scope");
for (const icon of manifest.icons || []) {
  const relativePath = icon.src.replace(/^\//, "");
  try {
    await access(path.join(root, "public", relativePath));
  } catch {
    fail(`Отсутствует PWA-иконка: ${icon.src}`);
  }
}

const serviceWorker = await text("public/sw.js");
if (!serviceWorker.includes('url.pathname.startsWith("/api/")')) fail("Service worker не исключает приватные API-ответы из кэша");

const { API_ENDPOINTS, buildOpenApiDocument } = await import("../src/lib/api-docs.js");
const endpointKeys = API_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`);
if (new Set(endpointKeys).size !== endpointKeys.length) fail("Документация API содержит повторяющиеся методы");
for (const tag of ["Чаты", "Конференции", "Телефония", "База знаний", "ИИ", "Записи встреч"])
  if (!API_ENDPOINTS.some((endpoint) => endpoint.tag === tag)) fail(`Документация API не содержит раздел «${tag}»`);
const openApi = buildOpenApiDocument("https://quality.example.ru");
if (openApi.openapi !== "3.1.0" || !openApi.paths?.["/api/search"] || !openApi.paths?.["/api/telephony/calls"] || !openApi.paths?.["/api/knowledge/spaces/{spaceId}/permissions"] || !openApi.paths?.["/api/conferences/{conferenceId}/messages"] || !openApi.paths?.["/api/conferences/{conferenceId}/hand"])
  fail("OpenAPI-контракт сформирован некорректно");
if (openApi.info.version !== packageJson.version) fail("Версия OpenAPI не совпадает с версией приложения");

const migrations = (await readdir(path.join(root, "scripts/migrations")))
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
for (const [index, name] of migrations.entries()) {
  const expected = String(index + 1).padStart(3, "0");
  if (!name.startsWith(`${expected}_`)) fail(`Нарушена последовательность миграций около ${name}`);
}
if (!migrations.length) fail("Не найдены миграции MySQL");

const deploymentFiles = [
  "Dockerfile",
  "compose.yaml",
  "docker-entrypoint.sh",
  "scripts/start.mjs",
  "deploy/helm/kontur-work/Chart.yaml",
  "deploy/helm/kontur-work/values.yaml",
  "deploy/helm/kontur-work/templates/deployment-app.yaml",
  "deploy/helm/kontur-work/templates/deployment-worker.yaml",
  "deploy/helm/kontur-work/templates/deployment-recording-worker.yaml",
  "deploy/helm/kontur-work/templates/egress-deployment.yaml",
  "deploy/helm/kontur-work/templates/migration-job.yaml",
  "deploy/helm/kontur-work/templates/livekit-deployment.yaml",
];
for (const file of deploymentFiles) {
  try {
    await access(path.join(root, file));
  } catch {
    fail(`Отсутствует компонент развёртывания: ${file}`);
  }
}
const helmChart = await text("deploy/helm/kontur-work/Chart.yaml");
if (!helmChart.includes(`appVersion: "${packageJson.version}"`))
  fail("appVersion Helm chart не совпадает с версией приложения");

const compose = await text("compose.yaml");
for (const service of ["mysql", "redis", "minio", "livekit", "migrate", "app", "worker", "recording-worker", "egress", "gateway"]) {
  if (!new RegExp(`^  ${service}:\\s*$`, "m").test(compose)) fail(`compose.yaml: отсутствует сервис ${service}`);
}

const uiSource = [
  await text("app/page.jsx"),
  await text("src/components/AdvancedViews.jsx"),
  await text("src/components/CommunicationsView.jsx"),
].join("\n");
const apiRoute = await text("app/api/[[...path]]/route.js");
const accessMigration = await text("scripts/migrations/008_conference_links_and_knowledge_acl.sql");
const conferenceCollaborationMigration = await text("scripts/migrations/009_conference_collaboration.sql");
if (/service\s*desc|service\s*desk|инцидент[- ]менеджмент|incident\s*management/i.test(uiSource)) {
  fail("В пользовательском интерфейсе обнаружен удалённый модуль service/incident management");
}
if (!uiSource.includes("aria-expanded={filtersOpen}")) fail("Кнопка фильтров канбана не сообщает открытое состояние");
if (!uiSource.includes('role="dialog" aria-modal="true"')) fail("Основные модальные окна не обозначены как диалоговые");
if (uiSource.includes("Authorization: Bearer kw_…") || uiSource.includes("Authorization: Bearer kw_..."))
  fail("В интерфейсе остался невыполнимый пример с сокращённым API-токеном");
if (!uiSource.includes("Начать сейчас") || !uiSource.includes("PeoplePicker"))
  fail("В интерфейсе конференций отсутствует быстрый запуск или поисковый выбор участников");
for (const feature of ["История сохраняется", "Поднять руку", "Задать вопрос"])
  if (!uiSource.includes(feature)) fail(`В комнате конференции отсутствует функция «${feature}»`);
if (/conferenceDraft\.capacity|conference\.capacity/.test(uiSource))
  fail("В интерфейсе конференций осталось ручное ограничение вместимости");
if (!uiSource.includes('advanced-task-line ${action ? "has-action"'))
  fail("Строка бэклога не резервирует отдельную колонку для селектора спринта");
if (!uiSource.includes("knowledgeSpacePermissions") || !uiSource.includes("knowledgeTeams"))
  fail("Интерфейс базы знаний не использует команды и ACL пространств");
if (apiRoute.includes("maxParticipants: conference.capacity"))
  fail("LiveKit всё ещё получает искусственный лимит участников");
if (!apiRoute.includes("canPublishData: false") || !apiRoute.includes("broadcastConferenceEvent"))
  fail("События конференции не защищены серверной публикацией LiveKit");
for (const contract of ["join_policy", "join_code", "knowledge_space_permissions", "knowledge_team_members"])
  if (!apiRoute.includes(contract) && !accessMigration.includes(contract))
    fail(`Не найден серверный контракт ${contract}`);
for (const contract of ["conference_messages", "hand_raised_at", "question_status"])
  if (!apiRoute.includes(contract) || !conferenceCollaborationMigration.includes(contract))
    fail(`Не найден контракт совместной работы конференции ${contract}`);

if (failures.length) {
  console.error("Проверка качества не пройдена:");
  for (const message of failures) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log(`Проверка качества пройдена: ${cssFiles.length} CSS-файла, ${cssRuleCount} блоков, PWA и UI-контракты корректны.`);
}
