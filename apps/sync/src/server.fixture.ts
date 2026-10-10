import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import worker, { type Statement, type SyncEnvironment } from "./index.ts";

class LocalStatement implements Statement {
  readonly sql: string;
  readonly values: (string | number | null)[];
  readonly database: DatabaseSync;
  constructor(database: DatabaseSync, sql: string, values: (string | number | null)[] = []) {
    this.database = database; this.sql = sql; this.values = values;
  }
  bind(...values: (string | number | null)[]): LocalStatement { return new LocalStatement(this.database, this.sql, values); }
  async first<T>(): Promise<T | null> { return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[] }> { return { results: this.execute<T>() }; }
  execute<T>(): T[] { return this.database.prepare(this.sql).all(...this.values) as T[]; }
}

// Runs the real Worker handler over HTTP with SQLite emulating only the D1 binding.
export async function startSyncFixture(directory: string) {
  const database = new DatabaseSync(join(directory, "cloud.sqlite"));
  database.exec(readFileSync(new URL("../migrations/0001_sync.sql", import.meta.url), "utf8"));
  const env: SyncEnvironment = {
    PASSWORD_PEPPER: "test-only-pepper-not-for-deployment",
    REGISTRATION_SECRET: "test-only-invite",
    AUTH_LIMITER: { async limit() { return { success: true }; } },
    DB: {
      prepare(sql) { return new LocalStatement(database, sql); },
      async batch<T>(statements: Statement[]) {
        database.exec("BEGIN IMMEDIATE");
        try {
          const results = statements.map(statement => ({ results: (statement as LocalStatement).execute<T>() }));
          database.exec("COMMIT");
          return results;
        } catch (error) { database.exec("ROLLBACK"); throw error; }
      },
    },
  };
  let offline = false;
  let dropNextPush = false;
  const server = createServer(async (incoming, outgoing) => {
    if (offline) { outgoing.destroy(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture port.");
    const request = new Request(`http://127.0.0.1:${address.port}${incoming.url}`, {
      method: incoming.method,
      headers: { ...Object.fromEntries(Object.entries(incoming.headers).filter(([, value]) => typeof value === "string")) } as Record<string, string>,
      ...(incoming.method === "GET" ? {} : { body: Buffer.concat(chunks).toString() }),
    });
    const response = await worker.fetch(request, env);
    if (dropNextPush && incoming.method === "POST" && incoming.url === "/sync") {
      dropNextPush = false; outgoing.destroy(); return;
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(await response.text());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port.");
  return {
    endpoint: `http://127.0.0.1:${address.port}`, env, database,
    setOffline(value: boolean) { offline = value; },
    dropNextPushResponse() { dropNextPush = true; },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); database.close(); },
  };
}
