import {generateMeteredAi} from './ai-budget.js';
import crypto from "node:crypto";
import { z } from "zod";
import { hasWorkspacePermission } from "./permissions.js";
import { audit } from "./audit.js";
import { AiError, listAiModels } from "./ai-client.js";
import { getAiSettings, publicAiSettings, saveAiSettings, aiProfileKey } from "./ai-settings.js";
import { createAiJob, listSourceAiJobs, getAiJob } from "./ai-service.js";

const id = z.coerce.number().int().positive().safe();
const send = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const createSchema = z.object({ recording_id: id.optional(), profile_id: z.string().uuid().optional(), instructions: z.string().trim().max(2000).default(""), regenerate: z.boolean().default(false), request_id: z.string().uuid().default(() => crypto.randomUUID()), join_code: z.string().uuid().optional() });

export async function handleAiApi(request, path, user) {
  const method = request.method;
  if (path[0] === "admin" && path[1] === "ai") {
    if (user.api_token_id || !(await hasWorkspacePermission(user, "ai.configure"))) throw new AiError(403, "Нет права настраивать ИИ");
    if (path.length === 2 && method === "GET") return send(publicAiSettings(await getAiSettings(user.workspace_id)));
    if (path.length === 2 && method === "PUT") {
      const saved = await saveAiSettings(user.workspace_id, await request.json(), user.id);
      await audit(user, "ai.settings.updated", "settings", "ai", { enabled: saved.enabled, profile_count: saved.profiles.length }, request);
      return send(saved);
    }
    if (path.length === 5 && path[2] === "profiles" && ["models", "test"].includes(path[4]) && method === "POST") {
      const profileId = z.string().uuid().parse(path[3]);
      const settings = await getAiSettings(user.workspace_id);
      const profile = settings.profiles.find((item) => item.id === profileId);
      if (!profile) throw new AiError(404, "Подключение не найдено; сначала сохраните настройки");
      if (path[4] === "models") return send({ models: await listAiModels(profile, aiProfileKey(profile)) });
      if (!profile.model) throw new AiError(422, "Укажите и сохраните модель для проверки генерации");
      const started = Date.now();
      await generateMeteredAi(user,'connection_test',profile,aiProfileKey(profile), "Ответь коротко по-русски.", "Проверка подключения. Напиши: Подключение работает.");
      await audit(user, "ai.connection.tested", "ai_profile", profile.id, { model: profile.model }, request);
      return send({ ok: true, model: profile.model, duration_ms: Date.now() - started, message: "Подключение и генерация работают" });
    }
  }
  const url = new URL(request.url);
  const joinCode = z.string().uuid().optional().parse(url.searchParams.get("join_code") || undefined);
  if (path[0] === "ai" && path[1] === "jobs" && path.length === 3 && method === "GET") return send(await getAiJob(user, id.parse(path[2]), joinCode));
  if (["projects", "conferences"].includes(path[0]) && path.length === 3 && path[2] === "ai") {
    const kind = path[0] === "projects" ? "project" : "conference";
    const sourceId = id.parse(path[1]);
    if (method === "GET") return send(await listSourceAiJobs(user, kind, sourceId, joinCode));
    if (method === "POST") {
      const result = await createAiJob(user, kind, sourceId, createSchema.parse(await request.json()));
      if (!result.cached) await audit(user, "ai.analysis.requested", kind, sourceId, { job_id: result.job.id }, request);
      return send(result, result.job.status === "completed" ? 200 : 202);
    }
  }
  throw new AiError(404, "Метод ИИ не найден");
}
