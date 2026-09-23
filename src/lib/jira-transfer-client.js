import {integrationUrl, integrationRequest} from './integration-http.js';

// Создаёт фиксированный код отказа, который обработчик покажет без ответа Jira и реквизитов.
function failure(code) {return Object.assign(new Error(code), {code});}

// Формирует безопасный адрес API, сохраняя контекстный путь установленной Jira.
function endpoint(source, path) {
  const url = integrationUrl(source.url);
  if (url.search) throw new Error('Адрес Jira не должен содержать параметры');
  return `${url.href.replace(/\/$/, '')}/rest/api/${source.kind === 'cloud' ? '3' : '2'}/${path}`;
}

// Формирует заголовок авторизации только для выбранного сервера Jira.
function headers(source, credentials) {
  return {authorization: source.kind === 'cloud' ? `Basic ${Buffer.from(`${credentials.username}:${credentials.token}`).toString('base64')}` : `Bearer ${credentials.token}`, accept: 'application/json'};
}

// Переводит сетевой ответ в фиксированную ошибку без текстов сервера и секретов.
function check(response) {
  if (response.status >= 200 && response.status < 300) return response;
  const code = response.status === 429 ? 'JIRA_RATE_LIMIT' : response.status >= 500 ? 'JIRA_UNAVAILABLE' : `JIRA_HTTP_${response.status}`;
  const seconds = Number(response.headers?.['retry-after']);
  const date = Date.parse(response.headers?.['retry-after'] || '');
  const retryAfter = Math.max(1, Math.min(86400, Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? Math.ceil((date - Date.now()) / 1000) : 30));
  throw Object.assign(new Error(code), {code, retryAfter});
}

// Читает JSON Jira с проверкой действующих прав перед каждым запросом.
async function json(source, credentials, path, options = {}, authorize = async () => {}) {
  await authorize();
  const response = check(await integrationRequest(endpoint(source, path), {...options, headers: headers(source, credentials), maxResponseBytes: 3000000}));
  try { return JSON.parse(response.text); } catch { throw Object.assign(new Error('JIRA_INVALID_RESPONSE'), {code: 'JIRA_INVALID_RESPONSE'}); }
}

// Загружает очередную страницу выбранного проекта; никакие изменения в Jira не отправляются.
export async function jiraPage(source, credentials, cursor = 0, authorize) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(source.project_key)) throw new Error('Неверный ключ проекта Jira');
  const cloud = source.kind === 'cloud';
  const body = {jql: `project = "${source.project_key}" ORDER BY id ASC`, maxResults: 25, fields: ['id', 'key'], ...(cloud ? (cursor ? {nextPageToken: String(cursor)} : {}) : {startAt: Number(cursor)})};
  const result = await json(source, credentials, cloud ? 'search/jql' : 'search', {method: 'POST', body: JSON.stringify(body)}, authorize);
  if (!Array.isArray(result.issues)) throw failure('JIRA_INVALID_RESPONSE');
  const next = cloud ? result.nextPageToken || null : Number(cursor) + result.issues.length < Number(result.total) ? Number(cursor) + result.issues.length : null;
  if (next !== null && !result.issues.length) throw failure('JIRA_EMPTY_PAGE');
  return {issues: result.issues, next, total: cloud ? null : result.total};
}

// Читает задачу и все доступные страницы комментариев; неполная история остаётся видимой в сверке.
export async function jiraIssue(source, credentials, id, authorize) {
  const key = encodeURIComponent(id);
  const issue = await json(source, credentials, `issue/${key}?fields=*all&expand=changelog,names`, {}, authorize);
  const comments = [];
  for (let start = 0; ; ) {
    const page = await json(source, credentials, `issue/${key}/comment?startAt=${start}&maxResults=100`, {}, authorize);
    if (!Array.isArray(page.comments)) throw failure('JIRA_INVALID_RESPONSE');
    comments.push(...page.comments);
    if (comments.length > 1000) throw failure('JIRA_COMMENTS_LIMIT');
    start += page.comments.length;
    if (start >= Number(page.total || 0)) break;
    if (!page.comments.length) throw failure('JIRA_EMPTY_PAGE');
  }
  issue.fields.comment = {comments, total: comments.length};
  if (Number(issue.changelog?.total || 0) > (issue.changelog?.histories?.length || 0) && source.kind === 'cloud') {
    const histories = [];
    for (let start = 0; ; ) {
      const page = await json(source, credentials, `issue/${key}/changelog?startAt=${start}&maxResults=100`, {}, authorize);
      if (!Array.isArray(page.values)) throw failure('JIRA_INVALID_RESPONSE');
      histories.push(...page.values);
      if (histories.length > 1000) throw failure('JIRA_HISTORY_LIMIT');
      start += page.values.length;
      if (page.isLast || start >= Number(page.total || 0)) break;
      if (!page.values.length) throw failure('JIRA_EMPTY_PAGE');
    }
    issue.changelog = {histories, total: histories.length};
  }
  return issue;
}

// Получает файл только с исходного сервера и контекстного пути, не следуя перенаправлениям.
export async function jiraFile(source, credentials, file, authorize = async () => {}) {
  const base = integrationUrl(source.url), url = integrationUrl(file.url);
  const prefix = base.pathname.replace(/\/$/, '') + '/';
  if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) throw new Error('Адрес файла не принадлежит выбранной Jira');
  const limit = Math.min(Number(process.env.MAX_ATTACHMENT_BYTES || 26214400), 100000000);
  if (!Number.isSafeInteger(file.expected_size) || file.expected_size < 0 || file.expected_size > limit) throw failure('JIRA_FILE_TOO_LARGE');
  await authorize();
  const response = check(await integrationRequest(url.href, {headers: headers(source, credentials), maxResponseBytes: Math.max(1, file.expected_size), binary: true}));
  if (!response.bytes || response.bytes.length !== file.expected_size) throw failure('JIRA_FILE_SIZE');
  return response.bytes;
}
