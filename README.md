# Dock

A desktop app for quickly capturing tasks and notes. The app stores everything locally in SQLite. An optional Cloudflare sync backend is included; a mobile client comes later.

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

`pnpm dev` launches Electron with live UI updates. `pnpm start` opens the production build. Run `pnpm package:mac` for a macOS DMG or `pnpm package:linux` for a Linux AppImage; installers appear in `apps/desktop/release`. The Apple Silicon Mac build has been tested locally with ad-hoc signing. Developer ID signing and notarization are not configured, and Windows packaging still needs validation.

## Continue on a Mac

With Node 22.20+ and Corepack installed, clone the private repository using your GitHub account:

```sh
gh repo clone nassimna/dock
cd dock
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open this folder in T3 Code to continue development. The default Mac capture shortcut is `Cmd + Shift + Space`; change it in Preferences if another app uses it. Check capture while another app is focused, the pinned mini window, and reminder permissions on your Mac. Linux X11 and macOS Electron journeys have passed locally; capture across physical Spaces and reminder delivery still need Mac device review.

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
  sync/             Cloudflare Worker, D1 migrations, and sync setup
  cli/              Local commands for people and agents
packages/
  contracts/        Runtime schemas and shared types
```

This follows inspected patterns from [Ternline](https://github.com/nassimna/ternline) (pnpm workspaces, electron-vite, separate main/preload/renderer, validated bridge) and [T3 Code](https://github.com/pingdotgg/t3code) (shared contracts and a single SQLite owner). The implementation is specific to Dock; it does not copy their application code or introduce their terminal and agent frameworks.

## Local behavior

- Tasks live in the Inbox or in projects; notes keep an Inbox, Work, or Personal space. Search covers titles, notes, labels, comments, and project names. Deleted items can be restored for 30 days or deleted permanently.
- Tasks support P1–P4 priorities, labels, nested subtasks, scheduled dates, separate deadlines, durations, multiple reminders, recurring follow-ups, completion history, and snooze. The original Important flag maps to P1; P1–P3 appear in the Priority view. Existing Work and Personal space tasks move into projects of the same name on first launch.
- A configurable global shortcut opens a separate capture window. Its draft remains when dismissed.
- A separate mini window shares the same data and can stay above other windows where the desktop supports it.
- Reminders run while Dock is running, including when hidden in the tray. Sleep delays are checked when the computer resumes. Operating-system notification permissions still apply.
- Today task creation defaults to the local date at 23:59; Inbox creation stays unscheduled. Inline capture and row actions share the same task commands.
- Notes support headings, inline formatting, lists, checklists, quotes, callouts, toggles, tables, code blocks, colors, an outline, and note links. Slash commands and block controls support insertion, conversion, duplication, and reordering. Save and autosave persist locally; plain notes use Markdown, while rich documents use HTML to retain their formatting through source editing and sync.
- Notes have labeled spaces, tags, linked tasks, and per-note typography preferences. The writing area fills the available height; the Full width button beside Save expands the page and remembers the choice for each note.
- Tasks show a brief completion animation and a completion message with Undo. Reduce Motion disables the animation.
- Dark and light themes with full color customization, compact/comfortable density, note font and text size, shortcut, quiet hours, and window preferences are saved locally.
- The CLI sends validated commands to the running app; it never opens a second database writer.

Cross-device sync now has a Workers + D1 backend and an offline queue. Connect an email/password account in Preferences after deploying the backend; see [sync setup](apps/sync/README.md). Sync is not deployed by default. Remote push notifications are not implemented. Native always-on-top is unavailable under Wayland, and global shortcuts depend on the compositor's portal support.

## Projects and planning

Create projects from the sidebar, nest them under a parent, and add sections in **Edit project**. Project lists group tasks by section; the board lets you drag or Option+arrow cards within and between columns, and its **Columns** menu and column menus show, hide, add, rename, reorder, and delete columns. Deleting a column moves its tasks to No section. Moving a private parent task also moves its subtasks. Completing a parent completes its subtasks; reopening it leaves their completed state intact.

**Upcoming** offers a weekly time grid and the month/list layout. Drag unscheduled tasks onto a half-hour slot, or move a calendar block; block length follows task duration and deadlines appear above each day. Task details include comments and local file copies (documents/images up to 25 MB each).

Inline add, task titles, and native quick capture recognize local rules such as `Write notes next Tue 9am p2 @writing for 45m #"Launch v0.2"`. Supported dates include today, tomorrow, next weekday, and YYYY-MM-DD; times use 9am or 14:30. `every weekday` and `every 2 weeks after completion` set recurrence. Recognized tokens are shown before saving. Unrecognized text stays in the title. This parser runs locally.

**Filters & labels** saves queries with `&`, `|`, `!`, and parentheses. Rules include today, overdue, no-date, done, p1–p4, #Project, @label, assigned:email, due:YYYY-MM-DD, and quoted text. Quote project names containing spaces. Queries exclude completed tasks unless they include `done`. Favorite filters appear in the sidebar. Templates apply reusable checklists atomically; **Select tasks** provides bulk completion, deletion, priority, project, and schedule changes. Cmd/Ctrl+K opens commands and task/project search. In task lists, J/K or the arrow keys move between tasks, Enter opens one beside the list, E completes it, Q adds a task, / searches, and Cmd/Ctrl+Z undoes the last completion, deletion, or quick edit.

**Progress** shows completion history, daily/weekly goals, and a daily-goal streak. Vacation intervals pause the streak. Completion timestamps for items created before this upgrade are initialized from their last update time. Goals, filters, templates, and label definitions stay local; task labels and private/shared project metadata travel through Dock Sync.

Automatic reminders wait for Electron's operating-system display acknowledgment before marking a reminder shown. Failed attempts retry up to three times with backoff; Preferences exposes the log and manual retry. A display acknowledgment does not prove that the user saw a notification. Quiet hours and running-in-tray behavior still apply.

Todoist CSV import supports quoted/multiline fields, sections, subtasks, priorities, durations, and ISO/date-formatted scheduling. Unsupported natural-language DATE values are rejected before importing; recurring CSV date text must be converted to dates first. Attachments remain local to the source computer. Account recovery, named devices, shared projects, and assignees use Dock's own optional sync server; apply its new migration before deployment as described in [sync setup](apps/sync/README.md). No paid or third-party integration is required by these local features.

## App updates

Installed builds check Dock’s GitHub releases at startup and every six hours when **Check and download updates automatically** is enabled in Preferences. A small update icon appears in the main window and sticky window after a newer version is found. Downloads show progress and retry actions; **Restart to update** waits for note saves and protects unfinished drafts.

`pnpm package:mac` produces a DMG, ZIP and `latest-mac.yml`. Publish the installers and metadata from the same versioned build together in a GitHub release. Packaging uses `--publish never`; it does not publish a release. Windows NSIS and Linux AppImage builds use electron-updater’s native installers.

Developer ID signed Mac installations keep the native updater. Local ad-hoc Mac builds use a separate installer that verifies the ZIP checksum, bundle ID, version and code integrity before replacing Dock after shutdown. It preserves the data directory and restores the previous bundle if replacement or launch submission fails. This distribution trusts the configured release origin; production signing and notarization require a Developer ID setup. See [electron-builder’s update documentation](https://www.electron.build/v26/docs/features/auto-update/) (checked 23 October 2026).

## UI development

The renderer uses checked-in shadcn/ui controls under `apps/desktop/src/renderer/src/components/ui`, configured by `apps/desktop/components.json`. Compose those controls for new screens. Buttons, inputs and selects share rem-based size variants in `components/ui/control-sizes.ts`; choose the same `size` for controls in a row instead of overriding their heights or text sizes in screen CSS. Use rem for interface spacing and icons so the layout follows root font scaling. Color and radius tokens live in `styles.css`; Tailwind utilities and screen layouts use the same tokens in every window. `ActionButton` adds a tooltip and accessible label to icon actions.

Notes use Tiptap with Markdown for ordinary documents and HTML for rich blocks and formatting. Supported editing is exercised in Electron; the upstream Markdown extension is currently labeled beta. Attachments, Notion databases, page hierarchy, and live collaborative editing are outside this version. References checked 9 October 2026: [shadcn/ui theming](https://ui.shadcn.com/docs/theming) and [Tiptap Markdown](https://tiptap.dev/docs/editor/markdown/getting-started/installation).

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

The database is `dock.sqlite` in the OS application-data directory under `Dock`: `~/.config/Dock` on Linux (or `$XDG_CONFIG_HOME/Dock`), `~/Library/Application Support/Dock` on macOS, and `%APPDATA%/Dock` on Windows. Preferences show the exact location. Preferences lists automatic daily JSON backups (up to 30 copies), creates manual backups, and imports JSON or Todoist project CSV files. Restore recovers missing/deleted records and preserves current items and preferences. Recently deleted tasks and notes can be restored for 30 days. Local attachment copies are stored alongside the database; JSON backups contain their references, so keep the attachments folder when moving a complete profile.

`pnpm test` runs focused SQLite, recurrence, reminder, local API, and sync checks in a disposable profile. `pnpm test:desktop` exercises the real production Electron build after `pnpm build`, including an app restart. On Linux it needs existing `Xvfb` and `xdotool` commands and uses an isolated display. Screenshots go to `.validation/screenshots` or `DOCK_EVIDENCE_DIR`. Test profiles and displays are removed afterward.

The desktop checks use Electron's normal sandbox settings. Renderer Node access is disabled and the isolated preload exposes only validated commands and subscriptions. Physical notification delivery is unverified because the test uses an isolated notification bus. Linux X11 and macOS desktop behavior have been exercised locally; Windows and Wayland require their own device checks.

## Reference inspection

Inspected locally on 8 October 2026: Ternline at `c052aed`, and Nassim's T3 Code fork at `412e91a7b`. Relevant references: `apps/desktop/electron.vite.config.ts`, `src/preload/index.ts`, `src/shared/desktop-bridge.ts` in Ternline; `apps/desktop/src/preload.ts`, `packages/contracts`, and `apps/server/src/persistence/NodeSqliteClient.ts` in T3 Code.

The earlier HTML design artifacts and local validation evidence remain in the originating workspace.
