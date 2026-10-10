import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { syncTokenSchema, syncMutationSchema, syncLoginSchema, syncSignupSchema } from "../../../packages/contracts/src/index.ts";

export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface SyncEnvironment {
  PASSWORD_PEPPER: string;
  REGISTRATION_SECRET: string;
  AUTH_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
  DB: {
    prepare(sql: string): Statement;
    batch<T>(statements: Statement[]): Promise<{ results: T[] }[]>;
  };
}
type RecordRow = { payload: string; version: number };


function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
function randomSecret(): string { return hex(crypto.getRandomValues(new Uint8Array(32))); }
async function sha256(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function equal(left: string, right: string): boolean {
  return left.length === right.length && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
async function hashPassword(password: string, salt: string, pepper: string): Promise<string> {
  const encoder = new TextEncoder();
  const pepperKey = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const material = await crypto.subtle.sign("HMAC", pepperKey, encoder.encode(password));
  return scryptSync(Buffer.from(material), salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString("hex");
}
async function readJSON(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("A request body is required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); throw new RangeError("Request too large."); }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export default {
  async fetch(request: Request, env: SyncEnvironment): Promise<Response> {
    const url = new URL(request.url);
    const headers = { "Cache-Control": "no-store" };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (url.pathname === "/health" && request.method === "GET") return json({ ok: true });
    if (!["/auth/signup", "/auth/login", "/auth/logout", "/account", "/sync"].includes(url.pathname)) return json({ error: "Unknown endpoint." }, 404);
    try {
      if (url.pathname === "/auth/signup" || url.pathname === "/auth/login") {
        if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
        const ipLimit = await env.AUTH_LIMITER.limit({ key: `dock:auth:ip:${request.headers.get("CF-Connecting-IP") ?? "local"}` });
        if (!ipLimit.success) return json({ error: "Too many sign-in attempts. Try again in a minute." }, 429);
        const signup = url.pathname === "/auth/signup";
        const body = await readJSON(request);
        const parsed = signup ? syncSignupSchema.safeParse(body) : syncLoginSchema.safeParse(body);
        if (!parsed.success) return json({ error: "Enter a valid email and a password of 12–128 characters." }, 400);
        const { email, password } = parsed.data;
        if (!(await env.AUTH_LIMITER.limit({ key: `dock:auth:email:${email}` })).success)
          return json({ error: "Too many sign-in attempts. Try again in a minute." }, 429);
        if (!env.PASSWORD_PEPPER || !env.REGISTRATION_SECRET) throw new Error("Missing authentication secrets.");
        const existing = await env.DB.prepare("SELECT id, password_hash, password_salt FROM accounts WHERE email = ?")
          .bind(email).first<{ id: string; password_hash: string; password_salt: string }>();
        let accountId: string;
        let passwordHash = "";
        let salt = "";
        if (signup) {
          const invite = syncSignupSchema.parse(body).inviteCode;
          if (!equal(await sha256(invite), await sha256(env.REGISTRATION_SECRET)))
            return json({ error: "The invite code is incorrect." }, 403);
          if (existing) return json({ error: "Unable to create this account. Try signing in." }, 409);
          accountId = crypto.randomUUID();
          salt = randomSecret();
          passwordHash = await hashPassword(password, salt, env.PASSWORD_PEPPER);
        } else {
          const candidate = await hashPassword(password, existing?.password_salt ?? "0".repeat(64), env.PASSWORD_PEPPER);
          if (!existing || !equal(candidate, existing.password_hash))
            return json({ error: "Email or password is incorrect." }, 401);
          accountId = existing.id;
        }
        const token = `${accountId}.${randomSecret()}`;
        const tokenHash = await sha256(token);
        const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
        const statements = signup ? [env.DB.prepare(
          "INSERT INTO accounts(id, email, password_hash, password_salt) VALUES(?, ?, ?, ?) ON CONFLICT(email) DO NOTHING",
        ).bind(accountId, email, passwordHash, salt)] : [];
        statements.push(
          env.DB.prepare("DELETE FROM sessions WHERE account_id = ? AND expires_at <= ?").bind(accountId, new Date().toISOString()),
          env.DB.prepare("INSERT INTO sessions(token_hash, account_id, expires_at) SELECT ?, id, ? FROM accounts WHERE id = ?").bind(tokenHash, expiresAt, accountId),
          env.DB.prepare("SELECT account_id FROM sessions WHERE token_hash = ?").bind(tokenHash),
        );
        const results = await env.DB.batch<{ account_id: string }>(statements);
        if (!results.at(-1)?.results.length) return json({ error: "Unable to create this account. Try signing in." }, 409);
        return json({ accountId, email, token, expiresAt });
      }
      const token = syncTokenSchema.safeParse(request.headers.get("Authorization")?.replace(/^Bearer /, ""));
      if (!token.success) return json({ error: "Sign in to sync your devices." }, 401);
      const accountId = token.data.split(".")[0]!;
      const tokenHash = await sha256(token.data);
      const account = await env.DB.prepare(`SELECT accounts.id, accounts.email FROM sessions
        JOIN accounts ON accounts.id = sessions.account_id
        WHERE sessions.account_id = ? AND token_hash = ? AND expires_at > ?`)
        .bind(accountId, tokenHash, new Date().toISOString()).first<{ id: string; email: string }>();
      if (!account) return json({ error: "Your session expired or was revoked. Sign in again; your local changes are safe." }, 401);
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash)]);
        return json({ ok: true });
      }
      if (url.pathname === "/account" && request.method === "GET") return json({ accountId, email: account.email });
      if (url.pathname !== "/sync") return json({ error: "Method not allowed." }, 405);
      if (request.method === "GET") {
        const rawCursor = url.searchParams.get("cursor") ?? "0";
        const cursor = Number(rawCursor);
        if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(cursor)) return json({ error: "Invalid sync cursor." }, 400);
        const { results } = await env.DB.prepare(
          "SELECT sequence, payload, version FROM changes WHERE account_id = ? AND sequence > ? ORDER BY sequence LIMIT 101",
        ).bind(accountId, cursor).all<RecordRow & { sequence: number }>();
        const changes = results.slice(0, 100).map(row => ({ sequence: row.sequence, version: row.version, item: JSON.parse(row.payload) }));
        return json({ changes, cursor: changes.at(-1)?.sequence ?? cursor, hasMore: results.length > 100 });
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      const input = await readJSON(request);
      const parsed = syncMutationSchema.safeParse(input);
      if (!parsed.success) return json({ error: "Invalid sync change." }, 400);
      const { item, mutationId, baseVersion } = parsed.data;
      for (const [reference, kind] of [[item.linkedNoteId, "note"], [item.recurrenceSourceId, "task"]] as const) {
        if (reference && !await env.DB.prepare("SELECT item_id FROM records WHERE account_id = ? AND item_id = ? AND json_extract(payload, '$.kind') = ?")
          .bind(accountId, reference, kind).first()) return json({ error: "Sync the linked item first." }, 409);
      }
      const previous = await env.DB.prepare("SELECT payload FROM records WHERE account_id = ? AND item_id = ?")
        .bind(accountId, item.id).first<{ payload: string }>();
      if (previous && JSON.parse(previous.payload).kind !== item.kind) return json({ error: "An item cannot change kind." }, 400);
      const payload = JSON.stringify(item);
      const receipt = env.DB.prepare("SELECT item_id, version FROM mutations WHERE account_id = ? AND mutation_id = ?").bind(accountId, mutationId);
      const result = await env.DB.batch<{ version: number; item_id?: string; payload?: string }>([
        env.DB.prepare(`INSERT INTO records(account_id, item_id, version, payload, mutation_id)
          SELECT ?, ?, 1, ?, ? WHERE ? = 0 AND NOT EXISTS
            (SELECT 1 FROM mutations WHERE account_id = ? AND mutation_id = ?)
          ON CONFLICT(account_id, item_id) DO NOTHING`).bind(accountId, item.id, payload, mutationId, baseVersion, accountId, mutationId),
        env.DB.prepare(`UPDATE records SET version = version + 1, payload = ?, mutation_id = ?
          WHERE account_id = ? AND item_id = ? AND version = ? AND version > 0 AND json_extract(payload, '$.kind') = ?
          AND NOT EXISTS (SELECT 1 FROM mutations WHERE account_id = ? AND mutation_id = ?)`)
          .bind(payload, mutationId, accountId, item.id, baseVersion, item.kind, accountId, mutationId),
        env.DB.prepare(`INSERT INTO mutations(account_id, mutation_id, item_id, version)
          SELECT account_id, mutation_id, item_id, version FROM records
          WHERE account_id = ? AND item_id = ? AND mutation_id = ? AND version = ?
          ON CONFLICT(account_id, mutation_id) DO NOTHING`).bind(accountId, item.id, mutationId, baseVersion + 1),
        receipt,
        env.DB.prepare("SELECT payload, version FROM records WHERE account_id = ? AND item_id = ?").bind(accountId, item.id),
      ]);
      const accepted = result[3]!.results[0];
      const current = result[4]!.results[0];
      if (!current?.payload) return json({ error: "The item has not been synced yet. Reconnect using the original account." }, 409);
      if (accepted && accepted.item_id !== item.id) return json({ error: "Mutation ID was already used for another item." }, 409);
      return json({ accepted: Boolean(accepted), version: accepted?.version ?? current.version,
        current: { item: JSON.parse(current.payload), version: current.version } });
    } catch (error) {
      if (error instanceof SyntaxError) return json({ error: "Invalid JSON." }, 400);
      if (error instanceof RangeError) return json({ error: "Request is too large." }, 413);
      return json({ error: "Sync service is temporarily unavailable. Your local changes are safe." }, 503);
    }
  },
};
