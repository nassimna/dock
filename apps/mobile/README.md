# Rivnote for Android

Expo54 / React Native0.81.5 mobile app using the e-commerce app's Expo Router,
NativeWind, TanStack Query, MMKV, i18next and feature folder conventions. The
transactional SQLite database, sync protocol, task parser, recurrence, filters,
CSV import and color presets are shared with desktop through `@dock/core`.

## Use

The production app is **Rivnote**, package `net.devexa.dock`, version0.2.0 (4).
The default server is `https://rivnote-sync.najjarnassim1995.workers.dev`. Open Settings →
Sync across devices, create an account with your email and a password of at least 12 characters,
and save the recovery code privately. No invite or server configuration is needed. Use that same server and account in
Rivnote desktop. Sessions are kept in Android SecureStore; local data works
without a connection and queued edits retry while the app is active.

The local database is `rivnote.sqlite`. Existing `dock.sqlite` files migrate automatically on startup, preserving saved data and pending sync edits.

Tasks, notes, private project metadata and shared projects sync. Attachment
metadata syncs, but attachment files stay on the device where they were added,
matching desktop's current protocol. Preferences, filters, templates, goals,
backups and local drafts also stay on each device. Export a backup before
uninstalling: uninstalling removes local SQLite, drafts and attachment files.
JSON backups contain attachment references, rather than the files themselves.

Supported mobile flows include P1–P4 priorities, scheduling/deadlines/duration,
recurrence/subtasks, labels/comments/attachments, linked notes, projects/sections,
list/board/week agenda, saved filters, templates, bulk operations, undo, trash,
goals/streak/vacation, rich notes, theme colors/spacing/fonts, English/Arabic,
JSON backups, Todoist CSV import, session/device/recovery and project sharing.
Mobile navigation and notifications replace desktop window/tray controls;
Android does not implement the desktop CLI, sticky windows, global shortcuts
or desktop automatic updater. Board moves use section selectors and move-up
buttons; calendar scheduling uses a week agenda and native date/time picker.

Add reminder requests notification permission when needed. You can also enable
notifications in Settings → Notifications, where the current permission status
is shown. Permission changes made in Android settings are picked up on return. Scheduled reminders are
registered with Android and can run after the app is closed. Android controls
permissions, exact-alarm access and battery restrictions. Tapping a reminder
opens its task. Completing or deleting a task cancels its pending reminders.

## Develop

Use Node22.20+ and pnpm10.34.5 from the repository root. Reuse an existing
compatible install, or run:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm dev:mobile
```

A development build is required because SQLite, MMKV, SecureStore, WebView and
notifications use native code. Expo Go is insufficient.

```sh
corepack pnpm --filter @dock/mobile android
```

The default development package is `net.devexa.dock.dev`, separate from the
production app. Rich notes use the e-commerce app's TenTap editor with the
same Tiptap version and rich blocks as desktop. `build:editor` embeds its
WebView JavaScript in the app; installation and release builds generate it.
No remote editor CDN or development server is needed by the release APK.

## Signed standalone APK

Keep the stable release keystore and signing properties outside the repository.
The private properties file contains `storeFile` (absolute path),
`storePassword`, `keyAlias`, and `keyPassword`. Back up both securely: future
updates must use the same signing key.

With JDK17 and the Android SDK36 / NDK27.1.12297006 available:

```sh
DOCK_ANDROID_SIGNING_PROPERTIES=/private/path/android-signing.properties \
  corepack pnpm --filter @dock/mobile build:apk
```

This generates the production native project and signs
`android/app/build/outputs/apk/release/app-release.apk`. The production plugin
requires the private key configuration and replaces the Expo debug-key default.
No EAS login or store publication is required. Source commits, GitHub releases
and store publication are separate actions.

## Structure and checks

`app/` contains thin routes; `features/items`, `features/workspace`,
`features/settings` and `features/sync` own their screens and operations.
`components/ui` follows the existing NativeWind/CVA primitives; `lib` owns the
SQLite/native runtime, SecureStore sync sessions, file tools, reminders, theme
and localization. The desktop retains its existing React/Tailwind versions.

```sh
corepack pnpm typecheck:mobile
corepack pnpm test:mobile
corepack pnpm typecheck
```

The focused mobile API tests use real SQLite with platform adapters replaced
for Node. These checks supplement actual Android validation; they do not prove
physical phone notification or battery behavior. Native test evidence and
release signing material remain outside version control.

## Sync conflicts

Settings → Sync conflicts shows competing versions. Review or edit either version,
then keep the current version, use the saved copy, or keep both. Decisions sync
to updated clients; discarded copies move to Recently deleted. Stale choices are
rejected. Older copies without a recorded original can safely be kept separately.

## Upgrade identity

Rivnote is the new name for Dock. The Android package, signing key, database,
MMKV and SecureStore identities stay the same, so installing the signed update
preserves local data and sessions. Existing theme choices are preserved; new
profiles use the River navy/teal palette.
