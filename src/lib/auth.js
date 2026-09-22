import { registerSession,liveSession } from "./session-store.js";
import { externalAccount,synchronizeGroups } from "./work-directory.js";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { Client } from "ldapts";
import { one, rows } from "./db.js";
import { decryptSecret } from "./crypto.js";
import { DEFAULT_API_SCOPES } from "./api-access.js";

export { hasProjectPermission } from "./permissions.js";

export const SESSION_COOKIE = "kontur_session";
const encoder = new TextEncoder();

function authKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET должен содержать не менее 32 символов");
  return encoder.encode(secret);
}

export async function createSessionToken(user, request, mfaVerified=false) {
  if(user.is_service)throw new Error("Служебная учётная запись не поддерживает вход");
  const sessionId=await registerSession(user,request,mfaVerified);
  return new SignJWT({
    workspaceId: String(user.workspace_id),
    role: user.global_role,
    name: user.display_name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("12h")
    .setJti(sessionId)
    .sign(authKey());
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL || "").startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 12,
  };
}

export async function currentUser(request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer kw_")) {
    const rawToken = authorization.slice(7);
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const apiUser = await one(
      `SELECT u.id, u.workspace_id, u.email, u.display_name, u.global_role, u.auth_source, u.status, u.avatar_color, u.is_service,
              at.id AS api_token_id, at.scopes_json, uaa.enabled AS api_enabled, uaa.allowed_scopes_json
       FROM api_tokens at JOIN users u ON u.id=at.user_id LEFT JOIN user_api_access uaa ON uaa.user_id=u.id
       WHERE at.token_hash=? AND at.revoked_at IS NULL AND (at.expires_at IS NULL OR at.expires_at>CURRENT_TIMESTAMP) AND u.status='active'`,
      [tokenHash],
    );
    if (apiUser && !apiUser.is_service) {
      await rows("UPDATE api_tokens SET last_used_at=CURRENT_TIMESTAMP WHERE id=?", [apiUser.api_token_id]);
      return apiUser;
    }
    return null;
  }
  if (authorization) return null;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authKey(), { algorithms: ["HS256"] });
    const user = await one(
      "SELECT id, workspace_id, email, display_name, global_role, auth_source, status, avatar_color, is_service FROM users WHERE id = ? AND workspace_id = ? AND status = 'active'",
      [payload.sub, payload.workspaceId],
    );
    if (!user || user.is_service) return null;
    const session=await liveSession(payload.jti,user.id);
    return session?{...user,session_id:session.id,session_created_at:session.created_at,mfa_verified:Boolean(session.mfa_verified)}:null;
  } catch {
    return null;
  }
}

export async function authenticateLocal(email, password) {
  const user = await one("SELECT * FROM users WHERE email = ? AND auth_source = 'local' AND status = 'active' LIMIT 1", [email.toLowerCase()]);
  if (user?.is_service || !user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) return null;
  await rows("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", [user.id]);
  return user;
}

function escapeLdap(value) {
  return String(value).replace(/\\/g, "\\5c").replace(/\*/g, "\\2a").replace(/\(/g, "\\28").replace(/\)/g, "\\29").replace(/\0/g, "\\00");
}

export async function authenticateLdap(login, password, config, workspaceId = 1) {
  if (!config?.enabled || !config.url || !config.baseDn || !password) return null;
  const client = new Client({ url: config.url, timeout: 8000, connectTimeout: 8000, tlsOptions: { rejectUnauthorized: config.rejectUnauthorized !== false } });
  try {
    if (config.bindDn) await client.bind(config.bindDn, decryptSecret(config.bindPasswordEncrypted));
    const filter = (config.userFilter || "(mail={{login}})").replace("{{login}}", escapeLdap(login));
    const { searchEntries } = await client.search(config.baseDn, { scope: "sub", filter, sizeLimit: 2, attributes: ["dn", "mail", "displayName", "cn", "uid", "memberOf"] });
    if (searchEntries.length !== 1) return null;
    const entry = searchEntries[0];
    await client.bind(entry.dn, password);
    const email = String(entry.mail || login).toLowerCase();
    const name = String(entry.displayName || entry.cn || entry.uid || email);
    const user = await externalAccount(workspaceId,'ldap',entry.dn,email,name);
    if(user.status!=='active'||user.is_service)return null;
    await synchronizeGroups(user,'ldap',[].concat(entry.memberOf||[]).map(String));
    await rows('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?',[user.id]);
    return user;
  } finally {
    await client.unbind().catch(() => {});
  }
}
