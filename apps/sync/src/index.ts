import { scryptSync, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { recoveryInputSchema, syncFeatureCommandSchema, privateProjectsMutationSchema } from "../../../packages/contracts/src/sync-features.ts";
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
    if (!["/auth/signup", "/auth/login", "/auth/recover", "/auth/recovery", "/auth/devices", "/auth/revoke", "/auth/logout", "/account", "/projects", "/projects/invite", "/projects/remove", "/workspace", "/sync"].includes(url.pathname)) return json({ error: "Unknown endpoint." }, 404);
    try {
      if (url.pathname === "/auth/recover" && request.method === "POST") {
        if (!(await env.AUTH_LIMITER.limit({ key: `dock:recovery:ip:${request.headers.get("CF-Connecting-IP") ?? "local"}` })).success)
          return json({ error: "Too many recovery attempts. Try again in a minute." }, 429);
        const parsed = recoveryInputSchema.safeParse(await readJSON(request));
        if (!parsed.success) return json({ error: "Enter your email, recovery code, and a password of 12–128 characters." }, 400);
        const { email, password, recoveryCode } = parsed.data;
        if (!(await env.AUTH_LIMITER.limit({ key: `dock:recovery:email:${email}` })).success)
          return json({ error: "Too many recovery attempts. Try again in a minute." }, 429);
        const account = await env.DB.prepare("SELECT id, recovery_hash FROM accounts WHERE email = ?").bind(email)
          .first<{ id: string; recovery_hash: string | null }>();
        const suppliedHash = await sha256(recoveryCode.toLowerCase());
        if (!account?.recovery_hash || (parsed.data.expectedAccountId && parsed.data.expectedAccountId !== account.id) || !equal(suppliedHash, account.recovery_hash))
          return json({ error: "Email or recovery code is incorrect." }, 401);
        const salt = randomSecret();
        const hash = await hashPassword(password, salt, env.PASSWORD_PEPPER);
        const replacement = randomSecret();
        const replacementHash = await sha256(replacement);
        const token = `${account.id}.${randomSecret()}`;
        const tokenHash = await sha256(token);
        const expiresAt = new Date(Date.now() + 30 * 86400_000).toISOString();
        const result = await env.DB.batch([
          env.DB.prepare("UPDATE accounts SET password_hash = ?, password_salt = ?, recovery_hash = ? WHERE id = ? AND recovery_hash = ?")
            .bind(hash, salt, replacementHash, account.id, suppliedHash),
          env.DB.prepare("DELETE FROM sessions WHERE account_id = ? AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND recovery_hash = ?)")
            .bind(account.id, account.id, replacementHash),
          env.DB.prepare("INSERT INTO sessions(token_hash, account_id, expires_at, device_name) SELECT ?, id, ?, 'Recovered Dock desktop' FROM accounts WHERE id = ? AND recovery_hash = ?")
            .bind(tokenHash, expiresAt, account.id, replacementHash),
          env.DB.prepare("SELECT token_hash FROM sessions WHERE token_hash = ?").bind(tokenHash),
        ]);
        if (!result.at(-1)?.results.length) return json({ error: "The recovery code was already used. Try your latest code." }, 401);
        return json({ accountId: account.id, email, token, expiresAt, recoveryCode: replacement });
      }
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
        const recoveryCode = signup ? randomSecret() : "";
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
          "INSERT INTO accounts(id, email, password_hash, password_salt, recovery_hash) VALUES(?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING",
        ).bind(accountId, email, passwordHash, salt, await sha256(recoveryCode))] : [];
        const deviceName = typeof (body as { deviceName?: unknown }).deviceName === "string"
          ? String((body as { deviceName: string }).deviceName).trim().slice(0, 100) : "Dock desktop";
        statements.push(
          env.DB.prepare("DELETE FROM sessions WHERE account_id = ? AND expires_at <= ?").bind(accountId, new Date().toISOString()),
          env.DB.prepare("INSERT INTO sessions(token_hash, account_id, expires_at, device_name) SELECT ?, id, ?, ? FROM accounts WHERE id = ?").bind(tokenHash, expiresAt, deviceName || "Dock desktop", accountId),
          env.DB.prepare("SELECT account_id FROM sessions WHERE token_hash = ?").bind(tokenHash),
        );
        const results = await env.DB.batch<{ account_id: string }>(statements);
        if (!results.at(-1)?.results.length) return json({ error: "Unable to create this account. Try signing in." }, 409);
        return json({ accountId, email, token, expiresAt, ...(signup ? { recoveryCode } : {}) });
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
      if (url.pathname === "/auth/recovery" && request.method === "POST") {
        const recoveryCode = randomSecret();
        await env.DB.batch([env.DB.prepare("UPDATE accounts SET recovery_hash = ? WHERE id = ?").bind(await sha256(recoveryCode), accountId)]);
        return json({ recoveryCode });
      }
      if (url.pathname === "/auth/devices" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT token_hash, device_name, expires_at FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY expires_at DESC")
          .bind(accountId, new Date().toISOString()).all<{ token_hash: string; device_name: string; expires_at: string }>();
        return json({ devices: results.map(row => ({ id: row.token_hash, name: row.device_name, expiresAt: row.expires_at, current: row.token_hash === tokenHash })) });
      }
      if (url.pathname === "/auth/revoke" && request.method === "POST") {
        const input = syncFeatureCommandSchema.safeParse({ ...(await readJSON(request) as object), type: "sync.device.revoke" });
        if (!input.success || input.data.type !== "sync.device.revoke") return json({ error: "Invalid device." }, 400);
        if (input.data.id === tokenHash) return json({ error: "Use Disconnect to sign out this device." }, 400);
        await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE account_id = ? AND token_hash = ?").bind(accountId, input.data.id)]);
        return json({ ok: true });
      }
      if (url.pathname === "/workspace" && ["GET", "POST"].includes(request.method)) {
        const shared = await env.DB.prepare("SELECT id FROM shared_projects WHERE owner_id = ?").bind(accountId).all<{ id: string }>();
        const sharedIds = new Set(shared.results.map(project => project.id));
        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT payload, version FROM account_workspaces WHERE account_id = ?").bind(accountId).first<RecordRow>();
          return json({ version: row?.version ?? 0, projects: (row ? JSON.parse(row.payload) : []).filter((project: { id: string }) => !sharedIds.has(project.id)) });
        }
        const parsed = privateProjectsMutationSchema.safeParse(await readJSON(request));
        if (!parsed.success) return json({ error: "Invalid project metadata." }, 400);
        const { baseVersion, mutationId } = parsed.data;
        const projects = parsed.data.projects.filter(project => !sharedIds.has(project.id));
        const payload = JSON.stringify(projects);
        const results = await env.DB.batch<{ payload?: string; version: number }>([
          env.DB.prepare(`INSERT INTO account_workspaces(account_id, version, payload, mutation_id)
            SELECT ?, 1, ?, ? WHERE ? = 0 AND NOT EXISTS (SELECT 1 FROM workspace_mutations WHERE account_id = ? AND mutation_id = ?)
            ON CONFLICT(account_id) DO NOTHING`).bind(accountId, payload, mutationId, baseVersion, accountId, mutationId),
          env.DB.prepare(`UPDATE account_workspaces SET version = version + 1, payload = ?, mutation_id = ?
            WHERE account_id = ? AND version = ? AND NOT EXISTS
            (SELECT 1 FROM workspace_mutations WHERE account_id = ? AND mutation_id = ?)`)
            .bind(payload, mutationId, accountId, baseVersion, accountId, mutationId),
          env.DB.prepare(`INSERT INTO workspace_mutations(account_id, mutation_id, version)
            SELECT account_id, mutation_id, version FROM account_workspaces WHERE account_id = ? AND mutation_id = ? AND version = ?
            ON CONFLICT(account_id, mutation_id) DO NOTHING`).bind(accountId, mutationId, baseVersion + 1),
          env.DB.prepare("SELECT version FROM workspace_mutations WHERE account_id = ? AND mutation_id = ?").bind(accountId, mutationId),
          env.DB.prepare("SELECT payload, version FROM account_workspaces WHERE account_id = ?").bind(accountId),
        ]);
        const canonical = results[4]?.results[0];
        return json({ accepted: Boolean(results[3]?.results.length), version: canonical?.version ?? 0,
          projects: (canonical?.payload ? JSON.parse(canonical.payload) : []).filter((project: { id: string }) => !sharedIds.has(project.id)) });
      }
      if (url.pathname === "/projects" && request.method === "GET") {
        const known = (url.searchParams.get("known") ?? "").split(",").filter(Boolean);
        if (known.length > 500 || known.some(id => id.length > 36)) return json({ error: "Invalid known project IDs." }, 400);
        const { results } = await env.DB.prepare(`SELECT p.id, p.payload, a.email AS owner_email FROM shared_projects p
          JOIN accounts a ON a.id = p.owner_id WHERE p.owner_id = ? OR EXISTS
          (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.account_id = ?)`)
          .bind(accountId, accountId).all<{ id: string; payload: string; owner_email: string }>();
        const projects = [];
        for (const row of results) {
          const members = await env.DB.prepare("SELECT a.email FROM project_members m JOIN accounts a ON a.id = m.account_id WHERE m.project_id = ? ORDER BY a.email")
            .bind(row.id).all<{ email: string }>();
          projects.push({ ...JSON.parse(row.payload), ownerEmail: row.owner_email,
            members: [{ email: row.owner_email, role: "owner" }, ...members.results.map(member => ({ email: member.email, role: "member" }))] });
        }
        const records = await env.DB.prepare(`SELECT r.payload, r.version FROM records r JOIN shared_projects p
          ON p.id = json_extract(r.payload, '$.task.projectId') AND p.owner_id = r.account_id
          WHERE (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.account_id = ?))
          AND p.id NOT IN (SELECT value FROM json_each(?))
          ORDER BY r.version, r.item_id`).bind(accountId, accountId, JSON.stringify(known)).all<RecordRow>();
        return json({ projects, records: records.results.map(row => ({ item: JSON.parse(row.payload), version: row.version })) });
      }
      if (["/projects", "/projects/invite", "/projects/remove"].includes(url.pathname) && request.method === "POST") {
        const type = url.pathname === "/projects" ? "sync.project.share" : url.pathname === "/projects/invite" ? "sync.project.invite" : "sync.project.remove";
        const parsed = syncFeatureCommandSchema.safeParse({ ...(await readJSON(request) as object), type });
        if (!parsed.success || !["sync.project.share", "sync.project.invite", "sync.project.remove"].includes(parsed.data.type))
          return json({ error: "Invalid project request." }, 400);
        const input = parsed.data;
        if (input.type === "sync.project.share") {
          const existing = await env.DB.prepare("SELECT owner_id FROM shared_projects WHERE id = ?").bind(input.project.id).first<{ owner_id: string }>();
          if (existing && existing.owner_id !== accountId) return json({ error: "Only the owner can update a shared project." }, 403);
          if (input.project.parentId) return json({ error: "Share a top-level project. Move a sub-project to the top level first." }, 400);
          const linked = await env.DB.prepare("SELECT item_id FROM records WHERE account_id = ? AND json_extract(payload, '$.task.projectId') = ? AND json_extract(payload, '$.linkedNoteId') IS NOT NULL")
            .bind(accountId, input.project.id).first();
          if (linked) return json({ error: "Remove private note links from this project's tasks before sharing." }, 400);
          const outsideDependency = await env.DB.prepare(`SELECT r.item_id FROM records r WHERE r.account_id = ?
            AND json_extract(r.payload, '$.task.projectId') = ? AND EXISTS
            (SELECT 1 FROM json_each(json_array(json_extract(r.payload, '$.recurrenceSourceId'), json_extract(r.payload, '$.task.parentId'))) ref
              WHERE ref.value IS NOT NULL AND NOT EXISTS (SELECT 1 FROM records dep WHERE dep.account_id = r.account_id
                AND dep.item_id = ref.value AND json_extract(dep.payload, '$.task.projectId') = ?))`)
            .bind(accountId, input.project.id, input.project.id).first();
          if (outsideDependency) return json({ error: "Move this project's parent tasks and recurrence history into the same project before sharing." }, 400);
          await env.DB.batch([env.DB.prepare("INSERT INTO shared_projects(id, owner_id, payload) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload WHERE owner_id = ?")
            .bind(input.project.id, accountId, JSON.stringify(input.project), accountId)]);
          return json({ ok: true });
        }
        if (input.type !== "sync.project.invite" && input.type !== "sync.project.remove") return json({ error: "Invalid project request." }, 400);
        const project = await env.DB.prepare("SELECT owner_id FROM shared_projects WHERE id = ?").bind(input.projectId).first<{ owner_id: string }>();
        if (!project || project.owner_id !== accountId) return json({ error: "Only the project owner can manage members." }, 403);
        const member = await env.DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(input.email).first<{ id: string }>();
        if (!member) return json({ error: "That person must create an account on this Dock Sync server first." }, 404);
        if (member.id === accountId) return json({ error: "The owner already has access." }, 400);
        const statements = input.type === "sync.project.invite"
          ? [env.DB.prepare("INSERT OR IGNORE INTO project_members(project_id, account_id) VALUES(?, ?)").bind(input.projectId, member.id)]
          : [env.DB.prepare(`UPDATE records SET payload = json_set(payload, '$.task.assignee', '', '$.updatedAt', ?),
              version = version + 1, mutation_id = ? WHERE account_id = ? AND json_extract(payload, '$.task.projectId') = ?
              AND json_extract(payload, '$.task.assignee') = ?`)
              .bind(new Date().toISOString(), randomSecret().slice(0, 32), accountId, input.projectId, input.email),
            env.DB.prepare("DELETE FROM project_members WHERE project_id = ? AND account_id = ?").bind(input.projectId, member.id)];
        await env.DB.batch(statements);
        return json({ ok: true });
      }
      if (url.pathname !== "/sync") return json({ error: "Method not allowed." }, 405);
      if (request.method === "GET") {
        const rawCursor = url.searchParams.get("cursor") ?? "0";
        const cursor = Number(rawCursor);
        if (!/^\d+$/.test(rawCursor) || !Number.isSafeInteger(cursor)) return json({ error: "Invalid sync cursor." }, 400);
        const { results } = await env.DB.prepare(
          `SELECT c.sequence, c.payload, c.version FROM changes c WHERE c.sequence > ? AND
            (c.account_id = ? OR EXISTS (SELECT 1 FROM shared_projects p JOIN project_members m ON m.project_id = p.id
              WHERE p.owner_id = c.account_id AND p.id = json_extract(c.payload, '$.task.projectId') AND m.account_id = ?))
            ORDER BY c.sequence LIMIT 101`,
        ).bind(cursor, accountId, accountId).all<RecordRow & { sequence: number }>();
        const changes = results.slice(0, 100).map(row => ({ sequence: row.sequence, version: row.version, item: JSON.parse(row.payload) }));
        return json({ changes, cursor: changes.at(-1)?.sequence ?? cursor, hasMore: results.length > 100 });
      }
      if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
      const input = await readJSON(request);
      const parsed = syncMutationSchema.safeParse(input);
      if (!parsed.success) return json({ error: "Invalid sync change." }, 400);
      const { item, mutationId, baseVersion } = parsed.data;
      let storageAccountId = accountId;
      let isSharedProject = false;
      const projectId = item.task.projectId;
      if (projectId) {
        const shared = await env.DB.prepare(`SELECT p.owner_id, p.payload FROM shared_projects p WHERE p.id = ? AND
          (p.owner_id = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.account_id = ?))`)
          .bind(projectId, accountId, accountId).first<{ owner_id: string; payload: string }>();
        const exists = await env.DB.prepare("SELECT id FROM shared_projects WHERE id = ?").bind(projectId).first();
        if (exists && !shared) return json({ error: "You no longer have access to this shared project." }, 403);
        if (shared) {
          storageAccountId = shared.owner_id;
          isSharedProject = true;
          const sections = JSON.parse(shared.payload).sections as { id: string }[];
          if (item.task.sectionId && !sections.some(section => section.id === item.task.sectionId))
            return json({ error: "Choose a section that belongs to this project." }, 400);
          if (item.linkedNoteId) return json({ error: "Private note links cannot be attached to shared tasks." }, 400);
          if (item.task.assignee && item.task.assignee !== account.email) {
            const assignee = await env.DB.prepare(`SELECT a.id FROM accounts a WHERE a.email = ? AND
              (a.id = ? OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = ? AND m.account_id = a.id))`)
              .bind(item.task.assignee, shared.owner_id, projectId).first();
            if (!assignee) return json({ error: "Choose an assignee who belongs to this project." }, 400);
          }
        }
      }
      const ownership = await env.DB.prepare("SELECT account_id, payload FROM records WHERE item_id = ?").bind(item.id)
        .first<{ account_id: string; payload: string }>();
      if (ownership && ownership.account_id !== storageAccountId) return json({ error: "This item belongs to another workspace." }, 409);
      if (ownership) {
        const previousProject = JSON.parse(ownership.payload).task?.projectId;
        if (isSharedProject && previousProject !== projectId && storageAccountId !== accountId)
          return json({ error: "Only the owner can move a private task into a shared project." }, 403);
        if (previousProject && previousProject !== projectId && await env.DB.prepare("SELECT id FROM shared_projects WHERE id = ?").bind(previousProject).first())
          return json({ error: "Shared tasks must stay in their shared project." }, 400);
      }
      for (const [reference, kind] of [[item.linkedNoteId, "note"], [item.recurrenceSourceId, "task"], [item.task.parentId, "task"]] as const) {
        if (!reference) continue;
        const dependency = await env.DB.prepare("SELECT payload FROM records WHERE account_id = ? AND item_id = ? AND json_extract(payload, '$.kind') = ?")
          .bind(storageAccountId, reference, kind).first<{ payload: string }>();
        if (!dependency) return json({ error: "Sync the linked item first." }, 409);
        if (isSharedProject && JSON.parse(dependency.payload).task?.projectId !== projectId)
          return json({ error: "Shared task dependencies must belong to the same project." }, 400);
      }
      const previous = await env.DB.prepare("SELECT payload FROM records WHERE account_id = ? AND item_id = ?")
        .bind(storageAccountId, item.id).first<{ payload: string }>();
      if (previous && JSON.parse(previous.payload).kind !== item.kind) return json({ error: "An item cannot change kind." }, 400);
      const payload = JSON.stringify(item);
      const receipt = env.DB.prepare("SELECT item_id, version FROM mutations WHERE account_id = ? AND mutation_id = ?").bind(storageAccountId, mutationId);
      const result = await env.DB.batch<{ version: number; item_id?: string; payload?: string }>([
        env.DB.prepare(`INSERT INTO records(account_id, item_id, version, payload, mutation_id)
          SELECT ?, ?, 1, ?, ? WHERE ? = 0 AND NOT EXISTS
            (SELECT 1 FROM mutations WHERE account_id = ? AND mutation_id = ?) AND NOT EXISTS
            (SELECT 1 FROM records WHERE item_id = ? AND account_id <> ?) AND
            (? = ? OR EXISTS (SELECT 1 FROM project_members WHERE project_id = ? AND account_id = ?))
          ON CONFLICT(account_id, item_id) DO NOTHING`).bind(storageAccountId, item.id, payload, mutationId, baseVersion, storageAccountId, mutationId, item.id, storageAccountId, storageAccountId, accountId, projectId, accountId),
        env.DB.prepare(`UPDATE records SET version = version + 1, payload = ?, mutation_id = ?
          WHERE account_id = ? AND item_id = ? AND version = ? AND version > 0 AND json_extract(payload, '$.kind') = ?
          AND NOT EXISTS (SELECT 1 FROM mutations WHERE account_id = ? AND mutation_id = ?)
          AND (? = ? OR EXISTS (SELECT 1 FROM project_members WHERE project_id = ? AND account_id = ?))`)
          .bind(payload, mutationId, storageAccountId, item.id, baseVersion, item.kind, storageAccountId, mutationId, storageAccountId, accountId, projectId, accountId),
        env.DB.prepare(`INSERT INTO mutations(account_id, mutation_id, item_id, version)
          SELECT account_id, mutation_id, item_id, version FROM records
          WHERE account_id = ? AND item_id = ? AND mutation_id = ? AND version = ?
          ON CONFLICT(account_id, mutation_id) DO NOTHING`).bind(storageAccountId, item.id, mutationId, baseVersion + 1),
        receipt,
        env.DB.prepare(`SELECT payload, version FROM records WHERE account_id = ? AND item_id = ?
          AND (? = ? OR EXISTS (SELECT 1 FROM project_members WHERE project_id = ? AND account_id = ?))`)
          .bind(storageAccountId, item.id, storageAccountId, accountId, projectId, accountId),
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
