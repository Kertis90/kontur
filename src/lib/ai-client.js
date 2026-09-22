import { z } from "zod";

export class AiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function normalizeAiBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new AiError(422, "Укажите корректный базовый URL ИИ"); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new AiError(422, "Endpoint должен использовать HTTP(S), без логина, пароля и query-параметров в URL");
  if (/^(169\.254\.|0\.|fe[89ab][0-9a-f]:)/i.test(host) || ["metadata", "metadata.google.internal", "100.100.100.200", "::", "fd00:ec2::254"].includes(host) || /^::ffff:(a9fe:|0:|6464:64c8$)/i.test(host))
    throw new AiError(422, "Служебный адрес инфраструктуры нельзя использовать как endpoint ИИ");
  if (/\/(chat\/completions|responses|models)\/?$/.test(url.pathname))
    throw new AiError(422, "Укажите базовый URL, например https://llm.company.ru/v1, без /chat/completions, /responses или /models");
  return url.toString().replace(/\/+$/, "");
}

export const aiProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  base_url: z.string().trim().min(1).max(1000).transform(normalizeAiBaseUrl),
  protocol: z.enum(["chat_completions", "responses"]).default("chat_completions"),
  model: z.string().trim().max(200).default(""),
  api_key: z.string().max(8000).optional(),
  clear_api_key: z.boolean().optional(),
  token_parameter: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
  max_output_tokens: z.number().int().min(128).max(32000).default(3000),
  max_input_chars: z.number().int().min(4000).max(300000).default(60000),
  temperature: z.number().min(0).max(2).nullable().default(null),
  timeout_seconds: z.number().int().min(10).max(300).default(120),
  instructions: z.string().trim().max(4000).default(""),
});

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  daily_user_limit: z.number().int().min(1).max(500).default(30),
  budget: z.object({enabled:z.boolean().default(false),monthly_user_tokens:z.number().int().min(1000).max(1000000000000).default(1000000),monthly_workspace_tokens:z.number().int().min(1000).max(1000000000000).default(10000000),max_concurrent:z.number().int().min(1).max(100).default(10)}).default({}),
  profiles: z.array(aiProfileSchema).max(20),
  project_profile_id: z.string().uuid().nullable(),
  conference_profile_id: z.string().uuid().nullable(),
  speech: z.object({
    enabled: z.boolean().default(false),
    live_captions: z.boolean().default(false),
    caption_user_minutes: z.number().int().min(1).max(1440).default(60),
    caption_workspace_minutes: z.number().int().min(1).max(100000).default(600),
    caption_concurrency: z.number().int().min(1).max(50).default(10),
    base_url: z.string().trim().max(1000).default("").transform((value) => value ? normalizeAiBaseUrl(value) : ""),
    model: z.string().trim().max(200).default("whisper-1"),
    language: z.string().regex(/^[a-z]{2,3}$/).default("ru"),
    api_key: z.string().max(8000).optional(),
    clear_api_key: z.boolean().optional(),
    timeout_seconds: z.number().int().min(30).max(600).default(180),
  }).default({}),
}).superRefine((settings, context) => {
  if (settings.speech.enabled && (!settings.speech.base_url || !settings.speech.model))
    context.addIssue({ code: "custom", path: ["speech"], message: "Укажите URL и модель распознавания речи" });
  if (new Set(settings.profiles.map((profile) => profile.id)).size !== settings.profiles.length)
    context.addIssue({ code: "custom", path: ["profiles"], message: "Идентификаторы подключений должны быть уникальными" });
  for (const key of ["project_profile_id", "conference_profile_id"])
    if (settings[key] && !settings.profiles.some((profile) => profile.id === settings[key] && profile.enabled))
      context.addIssue({ code: "custom", path: [key], message: "Выберите активное подключение" });
  if (settings.enabled && (!settings.project_profile_id || !settings.conference_profile_id))
    context.addIssue({ code: "custom", message: "Для включения ИИ выберите модели обоих сценариев" });
  if (settings.enabled && settings.profiles.some((profile) => profile.enabled && !profile.model))
    context.addIssue({ code: "custom", path: ["profiles"], message: "Для активных подключений нужно указать модель" });
});

export async function responseJson(response, maxBytes = 2_000_000) {
  if (Number(response.headers.get("content-length") || 0) > maxBytes)
    throw new AiError(502, "Ответ ИИ превышает допустимый размер");
  const reader = response.body?.getReader();
  if (!reader) throw new AiError(502, "Endpoint вернул пустой ответ");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AiError(502, "Ответ ИИ превышает допустимый размер"); }
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new AiError(502, "Endpoint вернул некорректный JSON"); }
  } finally { reader.releaseLock(); }
}

async function providerRequest(profile, key, suffix, payload, fetcher = fetch) {
  const base = normalizeAiBaseUrl(profile.base_url);
  try {
    const response = await fetcher(`${base}/${suffix}`, {
      method: payload ? "POST" : "GET",
      headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(profile.timeout_seconds * 1000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const hint = response.status === 401 || response.status === 403 ? "Проверьте ключ и доступ к модели" : response.status === 429 ? "Превышен лимит провайдера, попробуйте позже" : response.status === 404 ? "Проверьте базовый URL и имя модели" : "Проверьте параметры модели и протокол подключения";
      // Provider response bodies may echo keys, headers or submitted project text.
      throw new AiError(502, `ИИ: HTTP ${response.status}. ${hint}`);
    }
    return await responseJson(response);
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (["TimeoutError", "AbortError"].includes(error?.name)) throw new AiError(504, "ИИ не ответил за отведённое время");
    throw new AiError(502, "Не удалось подключиться к ИИ. Проверьте сеть, сертификат и базовый URL");
  }
}

export async function listAiModels(profile, key, fetcher) {
  const body = await providerRequest(profile, key, "models", null, fetcher);
  if (!Array.isArray(body.data)) throw new AiError(502, "Endpoint не поддерживает список /models; введите модель вручную");
  return [...new Set(body.data.map((model) => model?.id).filter((id) => typeof id === "string" && id.length <= 200))].sort().slice(0, 1000);
}

export async function generateAiText(profile, key, system, input, fetcher) {
  const responseMode = profile.protocol === "responses";
  const payload = responseMode
    ? { model: profile.model, instructions: system, input, max_output_tokens: profile.max_output_tokens, store: false, stream: false }
    : { model: profile.model, messages: [{ role: "system", content: system }, { role: "user", content: input }], [profile.token_parameter]: profile.max_output_tokens, stream: false };
  if (profile.temperature !== null) payload.temperature = profile.temperature;
  const body = await providerRequest(profile, key, responseMode ? "responses" : "chat/completions", payload, fetcher);
  let text;
  if (responseMode) {
    text = (body.output || []).filter((item) => item.type === "message").flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n");
    if (body.status && !["completed", "incomplete"].includes(body.status)) throw new AiError(502, "Модель не завершила генерацию текста");
  } else {
    const content = body.choices?.[0]?.message?.content;
    text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((item) => item.type === "text").map((item) => item.text).join("\n") : "";
  }
  if (!text?.trim()) throw new AiError(502, "Модель не вернула текст. Проверьте модель и лимит выходных токенов");
  const finiteCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    text: text.trim().slice(0, 200000),
    input_tokens: finiteCount(body.usage?.input_tokens ?? body.usage?.prompt_tokens),
    output_tokens: finiteCount(body.usage?.output_tokens ?? body.usage?.completion_tokens),
    incomplete: text.length > 200000 || body.status === "incomplete" || body.choices?.[0]?.finish_reason === "length",
  };
}
