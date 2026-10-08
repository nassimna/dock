# Dock

A desktop app for quickly capturing tasks and notes. The first version stores everything locally in SQLite. Mobile and Cloudflare synchronization come later.

The desktop application runs locally with a real SQLite database, native quick capture, a tray, and a pinned mini window. No cloud account is needed.

## Development

Requires Node 22.20+ and pnpm 10.34.5 (pinned in `package.json`). With Corepack, use `corepack pnpm` in place of `pnpm` if your global version differs.

```sh
pnpm install
pnpm dev
```

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm start
```

`pnpm dev` launches Electron with live UI updates. `pnpm start` opens the production build. To build a Linux installer locally, run `pnpm package:linux`; the AppImage appears in `apps/desktop/release`. macOS and Windows packaging targets are configured but need validation on those operating systems.

## Continue on a Mac

With Node 22.20+ and Corepack installed, clone the private repository using your GitHub account:

```sh
gh repo clone nassimna/dock
cd dock
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open this folder in T3 Code to continue development. The default Mac capture shortcut is `Cmd + Shift + Space`; change it in Preferences if another app uses it. Check capture while another app is focused, the pinned mini window, and reminder permissions on your Mac. Linux validation has passed; macOS device behavior is still pending.

To run the local checks:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm test:desktop
```

## Structure

```text
apps/
  desktop/
    src/main/       SQLite, reminders, windows, tray, and local command API
    src/preload/    Sandboxed, typed Electron bridge
    src/renderer/   React UI and application styles
  cli/              Local commands for people and agents
packages/
  contracts/        Runtime schemas and shared types
```

This follows inspected patterns from [Ternline](https://github.com/nassimna/ternline) (pnpm workspaces, electron-vite, separate main/preload/renderer, validated bridge) and [T3 Code](https://github.com/pingdotgg/t3code) (shared contracts and a single SQLite owner). The implementation is specific to Dock; it does not copy their application code or introduce their terminal and agent frameworks.

## Local behavior

- Tasks and notes support Inbox, Work, and Personal spaces, search, and deletion with undo.
- Tasks support priorities, scheduling, recurring follow-ups, completion, and snooze.
- A configurable global shortcut opens a separate capture window. Its draft remains when dismissed.
- A separate mini window shares the same data and can stay above other windows where the desktop supports it.
- Reminders run while Dock is running, including when hidden in the tray. Sleep delays are checked when the computer resumes. Operating-system notification permissions still apply.
- Dark and light themes, shortcut, quiet hours, and window preferences are saved locally.
- The CLI sends validated commands to the running app; it never opens a second database writer.

The cloud connection is deferred. Local window updates are real; cross-device synchronization and remote push notifications are not implemented yet. Native always-on-top is unavailable under Wayland, and global shortcuts depend on the compositor's portal support.

## Agent CLI

Keep Dock running, then use these commands from the project directory:

```sh
pnpm dock add "Review the proposal" --space Work --important
pnpm dock note "Friday call" --body "Prepare the agenda"
pnpm dock list --json
pnpm dock done ITEM-ID
pnpm dock snooze ITEM-ID --minutes 10
pnpm dock quick
pnpm dock mini
```

Run `pnpm dock help` for the full command list. The CLI uses a private token and a loopback-only command endpoint. Set `DOCK_DATA_DIR` for both the desktop and CLI, or pass `--data-dir PATH` to the CLI, to use a separate profile.

## Data and verification

The database is `dock.sqlite` in the OS application-data directory under `Dock`: `~/.config/Dock` on Linux (or `$XDG_CONFIG_HOME/Dock`), `~/Library/Application Support/Dock` on macOS, and `%APPDATA%/Dock` on Windows. Preferences show the exact location. A JSON backup can be exported there; importing backups is deferred.

`pnpm test` runs seven focused SQLite, recurrence, reminder, and local API checks in a disposable profile. `pnpm test:desktop` exercises the real production Electron build after `pnpm build`, including an app restart. On Linux it needs existing `Xvfb` and `xdotool` commands and uses an isolated display. Screenshots go to `.validation/screenshots` or `DOCK_EVIDENCE_DIR`. Test profiles and displays are removed afterward.

The desktop checks use Electron's normal sandbox settings. Renderer Node access is disabled and the isolated preload exposes only validated commands and subscriptions. Physical notification delivery is unverified because the test uses an isolated notification bus. Linux X11 behavior has been exercised; macOS, Windows, and Wayland require their own device checks.

## Reference inspection

Inspected locally on 8 October 2026: Ternline at `c052aed`, and Nassim's T3 Code fork at `412e91a7b`. Relevant references: `apps/desktop/electron.vite.config.ts`, `src/preload/index.ts`, `src/shared/desktop-bridge.ts` in Ternline; `apps/desktop/src/preload.ts`, `packages/contracts`, and `apps/server/src/persistence/NodeSqliteClient.ts` in T3 Code.

The earlier HTML design artifacts and local validation evidence remain in the originating workspace.
