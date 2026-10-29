import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const parent = resolve(".validation");
mkdirSync(parent, { recursive: true });
const directory = mkdtempSync(join(parent, "unit-"));
const child = spawn(
  process.execPath,
  [
    "--experimental-strip-types",
    "--test",
    "apps/desktop/src/main/database.test.ts",
    "apps/desktop/src/main/task-data.test.ts",
    "apps/desktop/src/main/local-services.test.ts",
    "apps/desktop/src/renderer/src/lib/tasks.test.ts",
    "apps/desktop/src/main/appearance.test.ts",
    "apps/desktop/src/main/updates.test.ts",
    "apps/desktop/src/main/mac-update-installer.test.ts",
    "apps/desktop/src/renderer/src/lib/theme.test.ts",
    "apps/desktop/src/main/note-properties.test.ts",
    "apps/desktop/src/main/reminders.test.ts",
    "apps/desktop/src/main/local-api.test.ts",
    "packages/core/tests/database.test.ts",
    "packages/core/tests/conflicts.test.ts",
    "apps/sync/src/auth.test.ts",
    "apps/sync/src/sync.test.ts",
    "apps/sync/src/features.test.ts",
    "apps/sync/src/conflicts.test.ts",
  ],
  { stdio: "inherit", env: { ...process.env, DOCK_TEST_ROOT: directory } },
);
child.on("error", (error) => {
  rmSync(directory, { recursive: true });
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  rmSync(directory, { recursive: true });
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
