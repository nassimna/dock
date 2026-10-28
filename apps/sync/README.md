# Rivnote sync backend

A Cloudflare Worker backed by D1. Rivnote keeps SQLite locally; signing in is optional. There is no Supabase or email service dependency.

Hosted on Nassim's personal Cloudflare account (`666ee3e55d6cef8ebeb2804d959cad8e`), using the `rivnote-sync` Worker and D1 database. Existing hosted clients normalize the retired Dock origin to the personal origin while retaining their account, session and queued edits.

## Deployment

Deployment creates a Worker and a D1 database and requires the Cloudflare account owner's authorization. Nothing in the local test commands creates cloud resources or containers. Wrangler is a deployment tool, not an added project dependency; use an existing Wrangler installation.

From `apps/sync`, after authorization:

1. Authenticate Wrangler to the intended Cloudflare account (`wrangler whoami` verifies the target).
2. Run `wrangler d1 create rivnote-sync`. Copy the returned database ID into `wrangler.jsonc`. Confirm the rate-limit namespace ID is unused in that account, or choose another one.
3. Apply the migration to **this new database only**: `wrangler d1 migrations apply rivnote-sync --remote`.
4. Generate a random `PASSWORD_PEPPER` with your password manager. Set it through Wrangler's interactive prompt:
   ```sh
   wrangler secret put PASSWORD_PEPPER
   ```
5. Run `wrangler deploy`. Use a Workers plan with enough CPU for password hashing; authentication must be measured in the Cloudflare runtime before considering it production-verified.
6. In Rivnote → Preferences → Sync across devices, use the built-in hosted origin, or open Advanced for a custom server. Create an account using your email and a password of at least 12 characters. Sign in with that email/password on each additional device.

The compatibility date enables Workers' Node.js support, including `node:crypto`. Passwords use scrypt (`N=32768, r=8, p=3`) with a random salt and a Worker-secret HMAC pepper. Preserve the pepper securely: replacing it invalidates existing password hashes.

Registration is public and rate-limited; no invitation is required. Email identifies the account; it is not verified. Signup returns a one-time recovery code. A signed-in device can generate a replacement code in Preferences; the new code invalidates the previous one. The code resets the password without an email service, revokes every existing session, and issues a replacement code and session. No verification or reset emails are sent. Losing both the password and recovery code requires help from the server owner. Device sessions show their computer name in Preferences and can be revoked individually. Sessions expire after 30 days. Online disconnect revokes the current session; offline disconnect only removes the encrypted local session.

The Worker has no CORS access for browser clients; the Electron main process and native Android client own network access. Bearer session hashes, not raw session tokens, are stored in D1. Authentication is rate-limited by account identifier and source IP.

## Sync behavior

- Private project names, nesting, colors, favorites, and sections sync through an account-scoped versioned metadata record before task content. Concurrent additions merge by project ID; a local pending edit to an existing project is retained when merging remote metadata. Shared project metadata remains controlled by its owner.
- Every content mutation is queued in the same local SQLite transaction. Preferences and notification-delivery markers remain local.
- On connect/reconnect, the client pulls account-scoped changes using a persistent cursor, then pushes queued records. Dependencies (linked notes and recurrence parents) sync first.
- Each mutation has a durable ID and an expected server version. D1's transactional batch applies a matching version once and records a retry receipt.
- Conflicting active content is retained as a separate “conflict copy.” The remote record remains the canonical item. An edit racing with deletion is kept as a copy; a local deletion racing with a remote edit preserves the remote edit.
- Tombstones propagate deletion and allow existing undo behavior. Change history and retry receipts are retained indefinitely in this first version; there is no history compaction yet.
- Recurrence IDs are deterministic per parent to avoid generating two future occurrences when two devices complete the same recurring task.
- Each local profile is permanently bound to its first account and server, including after disconnect. Use a different `DOCK_DATA_DIR` profile for another account to prevent cross-account uploads. Disconnect does not delete local items or queued changes.
- Sessions are encrypted with Electron `safeStorage`. A Linux plaintext key-store fallback is rejected. Passwords are never persisted on the device or returned in renderer snapshots.
- Sync retries automatically while Rivnote is running. The status distinguishes pending changes, sync progress, offline, and errors. The Android client uses the same protocol while active. Task reminders are scheduled locally; changes on another device do not send remote push alerts.

## Shared projects

Enable sharing from a top-level project, then invite an existing email account on the same server. The owner manages members and publishes project names/sections; members can edit tasks and assign them to other project members. Shared task payloads live in the owner's account partition and retain version checks and idempotent mutation receipts. Other accounts cannot read or mutate them.

The client bootstraps accessible project metadata and records before its regular incremental exchange. Losing membership removes the project from the next successful refresh, hides its local task cache, and excludes that cache from outgoing changes and reminders. An offline device retains its existing cache until it reconnects; revocation cannot remove already downloaded data remotely. Removing a member clears that member's task assignments.

Local attachment bytes never upload. Private note links cannot be included in a shared task, and shared tasks stay in their project. Local sub-projects must be moved to the top level before enabling sharing. Shared project metadata is updated with **Update shared project** in its member controls. Apply `0002_collaboration.sql` to the intended existing D1 database before deploying this server version; this change does not deploy or migrate cloud data automatically.

## Local verification

`pnpm test` includes Worker handler, authentication, migration, and two-client sync checks. The test server uses real HTTP and SQLite files in task-owned `.validation` storage, with a small adapter for D1 and a stub for Cloudflare's rate limiter. It never connects to a deployed backend. `pnpm typecheck` checks the Worker and desktop sources; `pnpm build` builds Electron.

Native Electron validation performed in this workspace also covered email/password signup, encrypted macOS sessions, offline edits, restart, reconnect, expired sessions, and disconnect. Evidence stays in `.validation`. Local adapter tests do not prove Cloudflare CPU limits, rate-limit behavior, or deployed D1 bindings. Live verification must exercise two devices against the deployed Worker before release.

References checked 9 October 2026: [D1 transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Workers crypto support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), [rate-limit bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [OWASP scrypt parameters](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
