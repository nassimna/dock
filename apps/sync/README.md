# Rivnote sync backend

A Cloudflare Worker backed by D1, using Better Auth 1.7.14 for email/password authentication and sessions. Rivnote keeps SQLite locally; signing in is optional. There is no Supabase or email service dependency.

Hosted on Nassim's personal Cloudflare account (`666ee3e55d6cef8ebeb2804d959cad8e`), using the `rivnote-sync` Worker and D1 database. Existing hosted clients normalize the retired Dock origin to the personal origin while retaining their account, session and queued edits.

## Authentication and deployment

Better Auth runs only in the Worker. The desktop main process and native mobile sync engine keep their existing `/auth/*` JSON protocol, encrypted session storage and account binding. The Expo and Electron SDK plugins are unnecessary for this email/password flow; there is no browser sign-in page, cookie persistence or deep-link exchange.

The Worker exposes only the native API. It does not expose Better Auth's raw handler or allow browser-origin requests. Signup/sign-in use Better Auth's APIs, session reads use `getSession`, and sign-out uses `signOut`. The Cloudflare `AUTH_LIMITER` binding limits sign-in and recovery by source IP and normalized email.

Sessions expire after 30 days. An app receives a `UUID.secret` bearer token where the secret is an HMAC derivative of Better Auth's internal session token, keyed by `BETTER_AUTH_SECRET`. Only the public token hash is indexed in D1; Better Auth's internal token is never returned by the API. This preserves the existing native protocol without making stored internal tokens usable as public bearer credentials. Device listing exposes hashed identifiers, and revocation remains scoped to the authenticated account. Preserve `BETTER_AUTH_SECRET`: rotating it requires a deliberate session migration or sign-in again.

New passwords use Better Auth's scrypt implementation. Migrated credentials retain a versioned legacy salt/hash and verify with the original HMAC-peppered scrypt (`N=32768, r=8, p=3`). `PASSWORD_PEPPER` is still required for those accounts and must not be changed. A password reset replaces the migrated credential; the old password columns never authenticate.

Email identifies an account but is not verified. No email provider is configured. Recovery codes remain supported: they rotate once, reset the password, revoke both old and Better Auth sessions and return a replacement code/session. This extension uses a conditional atomic D1 `batch()` because the Better Auth D1 adapter cannot use interactive transactions. Local data and sync ownership do not change.

### Upgrade the existing deployment

These steps change production and require authorization. Local checks do not apply remote migrations or create cloud resources.

1. From `apps/sync`, use the existing Wrangler installation and run `wrangler whoami`. Confirm the intended personal Cloudflare account and the existing `rivnote-sync` Worker/D1 IDs in `wrangler.jsonc`. **Do not create another database.**
2. Take a protected D1 export before the cutover. Keep the export outside the repository; it contains account data and password hashes.
3. Generate and set a new stable secret through Wrangler's interactive prompt: `wrangler secret put BETTER_AUTH_SECRET`. Keep the existing `PASSWORD_PEPPER` unchanged. Neither secret belongs in source control.
4. Quiesce the old Worker for the migration: it must not create users or sessions during cutover. Apply `wrangler d1 migrations apply rivnote-sync --remote`. Migration `0003_better_auth.sql` copies users with their original IDs, moves password hashes to Better Auth credential rows, preserves recovery codes, sync records and legacy sessions, and blanks the superseded password columns. The old Worker cannot authenticate after those columns are blanked. Deploy the prepared Worker immediately after migration.
5. Run `wrangler deploy`. The configuration enables `nodejs_compat`. Verify signup, an existing account's login, a pre-upgrade session, device revocation and desktop/mobile sync against the deployed Worker before calling the upgrade production-verified. Measure password hashing under the configured Workers CPU limit.

Do not roll back only the Worker to the pre-migration version: its credential columns have been retired. A rollback must restore a coordinated database/Worker backup while accounting for writes since cutover.

For a new self-hosted installation, create a dedicated D1 database, set its ID in your own configuration, apply all migrations, and set both secrets before deployment. Do not reuse the hosted database IDs for another installation.

Online sign-out revokes the current session; offline sign-out only removes its encrypted local copy. Legacy hashed sessions stay valid until their existing expiry and appear beside new sessions in device management. Recovery revokes both generations. There is no fallback to legacy passwords after migration.

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

Better Auth references (checked 2026-10-29): [D1](https://www.better-auth.com/docs/concepts/database), [email/password and custom verification](https://www.better-auth.com/docs/authentication/email-password), [sessions](https://www.better-auth.com/docs/concepts/session-management), [bearer plugin](https://www.better-auth.com/docs/plugins/bearer).
