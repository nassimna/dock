import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { betterAuth } from "better-auth";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { bearer } from "better-auth/plugins/bearer";
import { recoveryInputSchema, syncFeatureCommandSchema } from "../../../packages/contracts/src/sync-features.ts";
import { syncLoginSchema, syncTokenSchema } from "../../../packages/contracts/src/index.ts";

export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[]; meta: { changes: number; last_row_id: number } }>;
}
export interface SyncEnvironment {
  PASSWORD_PEPPER: string;
  BETTER_AUTH_SECRET: string;
  AUTH_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  DB: {
    prepare(sql: string): Statement;
    batch<T>(statements: Statement[]): Promise<{ results: T[] }[]>;
    exec(sql: string): Promise<unknown>;
  };
}

function hex(bytes: ArrayBuffer): string { return Buffer.from(bytes).toString("hex"); }
export function randomSecret(): string { return hex(crypto.getRandomValues(new Uint8Array(32)).buffer); }
export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function hmac(value: string, secret: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, encoder.encode(value));
}
function equal(left: string, right: string): boolean {
  return left.length === right.length && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
async function verifyCredential(hash: string, password: string, pepper: string): Promise<boolean> {
  if (!hash.startsWith("rivnote-v1:")) return verifyPassword({ hash, password });
  const [, salt, expected] = hash.split(":");
  if (!salt || !expected || !/^[0-9a-f]{64}$/.test(salt) || !/^[0-9a-f]{64}$/.test(expected)) return false;
  const material = await hmac(password, pepper);
  return equal(scryptSync(Buffer.from(material), salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString("hex"), expected);
}
// Internal Better Auth tokens never leave the Worker. Only a keyed derivative is
// usable by native clients, so a database dump cannot provide bearer credentials.
async function clientToken(env: SyncEnvironment, userId: string, token: string): Promise<string> {
  return `${userId}.${hex(await hmac(`rivnote-session:${userId}:${token}`, env.BETTER_AUTH_SECRET))}`;
}
export function createAuth(env: SyncEnvironment, origin: string) {
  if (!env.BETTER_AUTH_SECRET || !env.PASSWORD_PEPPER) throw new Error("Authentication secrets are required.");
  let createdUserId: string | undefined;
  const auth = betterAuth({
    appName: "Rivnote",
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    user: { modelName: "auth_user" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    session: {
      modelName: "auth_session", expiresIn: 30 * 86400, disableSessionRefresh: true,
      additionalFields: {
        deviceName: { type: "string", required: true, input: false },
        tokenHash: { type: "string", required: true, input: false, returned: false },
      },
    },
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      password: { hash: hashPassword, verify: ({ hash, password }) => verifyCredential(hash, password, env.PASSWORD_PEPPER) },
    },
    advanced: { database: { generateId: () => crypto.randomUUID() } },
    rateLimit: { enabled: false }, // Public requests use the Worker AUTH_LIMITER binding.
    plugins: [bearer()],
    databaseHooks: {
      user: { create: { after: async user => { createdUserId = user.id; } } },
      session: { create: { before: async (session, context) => ({ data: {
        ...session,
        deviceName: context?.headers?.get("x-rivnote-device") || "Rivnote device",
        tokenHash: await sha256(await clientToken(env, session.userId, session.token)),
      } }) } },
    },
  });
  return Object.assign(auth, { createdUserId: () => createdUserId });
}
export type Auth = ReturnType<typeof createAuth>;
export interface Identity { id: string; email: string; tokenHash: string; internalToken: string | null }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function authenticateRequest(auth: Auth, env: SyncEnvironment, request: Request): Promise<Identity | null> {
  const parsed = syncTokenSchema.safeParse(request.headers.get("Authorization")?.replace(/^Bearer /, ""));
  if (!parsed.success) return null;
  const userId = parsed.data.split(".")[0]!;
  const tokenHash = await sha256(parsed.data);
  const modern = await env.DB.prepare("SELECT token FROM auth_session WHERE userId = ? AND tokenHash = ?").bind(userId, tokenHash).first<{ token: string }>();
  if (modern) {
    const session = await auth.api.getSession({ headers: new Headers({ Authorization: `Bearer ${modern.token}` }) });
    return session?.user.id === userId ? { id: userId, email: session.user.email, tokenHash, internalToken: modern.token } : null;
  }
  const legacy = await env.DB.prepare(`SELECT a.id, a.email FROM sessions s JOIN accounts a ON a.id = s.account_id
    WHERE s.account_id = ? AND s.token_hash = ? AND s.expires_at > ?`)
    .bind(userId, tokenHash, new Date().toISOString()).first<{ id: string; email: string }>();
  return legacy ? { ...legacy, tokenHash, internalToken: null } : null;
}
async function limited(env: SyncEnvironment, request: Request, purpose: string, email?: string) {
  const key = email ? `rivnote:${purpose}:email:${email}` : `rivnote:${purpose}:ip:${request.headers.get("CF-Connecting-IP") ?? "local"}`;
  return !(await env.AUTH_LIMITER.limit({ key })).success;
}
async function credentials(auth: Auth, env: SyncEnvironment, token: string) {
  const session = await auth.api.getSession({ headers: new Headers({ Authorization: `Bearer ${token}` }) });
  if (!session) throw new Error("The new session could not be opened.");
  return { accountId: session.user.id, email: session.user.email,
    token: await clientToken(env, session.user.id, token), expiresAt: session.session.expiresAt.toISOString() };
}
export async function signIn(auth: Auth, env: SyncEnvironment, request: Request, body: unknown): Promise<Response> {
  if (await limited(env, request, "auth")) return json({ error: "Too many sign-in attempts. Try again in a minute." }, 429);
  const parsed = syncLoginSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Enter a valid email and a password of 12–128 characters." }, 400);
  if (await limited(env, request, "auth", parsed.data.email)) return json({ error: "Too many sign-in attempts. Try again in a minute." }, 429);
  const headers = new Headers({ "x-rivnote-device": typeof (body as { deviceName?: unknown }).deviceName === "string" ? String((body as { deviceName: string }).deviceName).trim().slice(0, 100) || "Rivnote device" : "Rivnote device" });
  const signup = new URL(request.url).pathname === "/auth/signup";
  // D1 cannot roll back Better Auth's multi-step signup. Compensate only for a
  // user created by this request whose credential insert did not complete.
  const removeIncompleteSignup = async () => {
    const id = auth.createdUserId();
    if (!id) return;
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM accounts WHERE id = ? AND NOT EXISTS (SELECT 1 FROM auth_account WHERE userId = ?)`).bind(id, id),
      env.DB.prepare(`DELETE FROM auth_user WHERE id = ? AND NOT EXISTS (SELECT 1 FROM auth_account WHERE userId = ?)`).bind(id, id),
    ]);
  };
  let response: Response;
  try {
    response = signup
      ? await auth.api.signUpEmail({ body: { ...parsed.data, name: parsed.data.email }, headers, asResponse: true })
      : await auth.api.signInEmail({ body: parsed.data, headers, asResponse: true });
  } catch (cause) {
    if (signup) await removeIncompleteSignup();
    throw cause;
  }
  if (!response.ok) {
    if (signup) await removeIncompleteSignup();
    if (response.status === 401) return json({ error: "Email or password is incorrect." }, 401);
    if (signup && response.status === 422) return json({ error: "Unable to create this account. Try signing in." }, 409);
    return json({ error: "The account service could not complete this request. Try again." }, response.status);
  }
  const result = await response.json() as { token: string };
  const session = await credentials(auth, env, result.token);
  if (!signup) return json(session);
  const recoveryCode = randomSecret();
  await env.DB.batch([env.DB.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = ? AND recovery_hash IS NULL").bind(await sha256(recoveryCode), session.accountId)]);
  return json({ ...session, recoveryCode });
}

export async function recoverAccount(auth: Auth, env: SyncEnvironment, request: Request, body: unknown): Promise<Response> {
  if (await limited(env, request, "recovery")) return json({ error: "Too many recovery attempts. Try again in a minute." }, 429);
  const parsed = recoveryInputSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Enter your email, recovery code, and a password of 12–128 characters." }, 400);
  const { email, password, recoveryCode, expectedAccountId } = parsed.data;
  if (await limited(env, request, "recovery", email)) return json({ error: "Too many recovery attempts. Try again in a minute." }, 429);
  const user = await env.DB.prepare("SELECT id, recovery_hash FROM accounts WHERE email = ?").bind(email).first<{ id: string; recovery_hash: string | null }>();
  const suppliedHash = await sha256(recoveryCode.toLowerCase());
  if (!user?.recovery_hash || expectedAccountId && expectedAccountId !== user.id || !equal(suppliedHash, user.recovery_hash)) return json({ error: "Email or recovery code is incorrect." }, 401);
  const context = await auth.$context;
  const passwordHash = await context.password.hash(password);
  const replacement = randomSecret(), replacementHash = await sha256(replacement);
  const internalToken = randomSecret(), token = await clientToken(env, user.id, internalToken), tokenHash = await sha256(token);
  const now = new Date().toISOString(), expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
  // D1 batches are atomic; Better Auth's interactive transactions are unsupported
  // here. Claim the recovery code, change credentials and revoke both session
  // generations together so concurrent recovery cannot partially reset an account.
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE accounts SET recovery_hash = ? WHERE id = ? AND recovery_hash = ?
      AND EXISTS (SELECT 1 FROM auth_account WHERE userId = ? AND providerId = 'credential')`).bind(replacementHash, user.id, suppliedHash, user.id),
    env.DB.prepare(`UPDATE auth_account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential'
      AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND recovery_hash = ?)`).bind(passwordHash, now, user.id, user.id, replacementHash),
    env.DB.prepare("DELETE FROM sessions WHERE account_id = ? AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND recovery_hash = ?)").bind(user.id, user.id, replacementHash),
    env.DB.prepare("DELETE FROM auth_session WHERE userId = ? AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND recovery_hash = ?)").bind(user.id, user.id, replacementHash),
    env.DB.prepare(`INSERT INTO auth_session(id, userId, token, expiresAt, createdAt, updatedAt, deviceName, tokenHash)
      SELECT ?, id, ?, ?, ?, ?, 'Recovered Rivnote device', ? FROM accounts WHERE id = ? AND recovery_hash = ?`)
      .bind(crypto.randomUUID(), internalToken, expiresAt, now, now, tokenHash, user.id, replacementHash),
    env.DB.prepare("SELECT id FROM auth_session WHERE tokenHash = ?").bind(tokenHash),
  ]);
  if (!result.at(-1)?.results.length) return json({ error: "The recovery code was already used. Try your latest code." }, 401);
  return json({ ...await credentials(auth, env, internalToken), recoveryCode: replacement });
}

export async function manageAccount(auth: Auth, env: SyncEnvironment, request: Request, identity: Identity, readBody: () => Promise<unknown>): Promise<Response | null> {
  const { id, tokenHash, internalToken } = identity;
  const url = new URL(request.url);
  if (url.pathname === "/account" && request.method === "GET") return json({ accountId: id, email: identity.email });
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    if (internalToken) await auth.api.signOut({ headers: new Headers({ Authorization: `Bearer ${internalToken}` }) });
    else await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE token_hash = ? AND account_id = ?").bind(tokenHash, id)]);
    return json({ ok: true });
  }
  if (url.pathname === "/auth/recovery" && request.method === "POST") {
    const recoveryCode = randomSecret();
    await env.DB.batch([env.DB.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = ?").bind(await sha256(recoveryCode), id)]);
    return json({ recoveryCode });
  }
  if (url.pathname === "/auth/devices" && request.method === "GET") {
    const modern = await env.DB.prepare("SELECT tokenHash, deviceName, expiresAt FROM auth_session WHERE userId = ? AND expiresAt > ? ORDER BY expiresAt DESC").bind(id, new Date().toISOString()).all<{ tokenHash: string; deviceName: string; expiresAt: string }>();
    const legacy = await env.DB.prepare("SELECT token_hash, device_name, expires_at FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY expires_at DESC").bind(id, new Date().toISOString()).all<{ token_hash: string; device_name: string; expires_at: string }>();
    return json({ devices: [
      ...modern.results.map(s => ({ id: s.tokenHash, name: s.deviceName, expiresAt: new Date(s.expiresAt).toISOString(), current: s.tokenHash === tokenHash })),
      ...legacy.results.map(s => ({ id: s.token_hash, name: s.device_name, expiresAt: s.expires_at, current: s.token_hash === tokenHash })),
    ] });
  }
  if (url.pathname === "/auth/revoke" && request.method === "POST") {
    const parsed = syncFeatureCommandSchema.safeParse({ ...await readBody() as object, type: "sync.device.revoke" });
    if (!parsed.success || parsed.data.type !== "sync.device.revoke") return json({ error: "Invalid device." }, 400);
    if (parsed.data.id === tokenHash) return json({ error: "Use Disconnect to sign out this device." }, 400);
    // The public identifier is a hash, never Better Auth's internal session token.
    const device = await env.DB.prepare("SELECT token FROM auth_session WHERE userId = ? AND tokenHash = ?").bind(id, parsed.data.id).first<{ token: string }>();
    if (device) await (await auth.$context).internalAdapter.deleteSession(device.token);
    await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE account_id = ? AND token_hash = ?").bind(id, parsed.data.id)]);
    return json({ ok: true });
  }
  return null;
}
