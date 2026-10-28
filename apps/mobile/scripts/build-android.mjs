import { spawnSync } from "node:child_process";
import { accessSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (!process.env.DOCK_ANDROID_SIGNING_PROPERTIES) {
  throw new Error(
    "Set DOCK_ANDROID_SIGNING_PROPERTIES to your private signing properties file.",
  );
}
accessSync(process.env.DOCK_ANDROID_SIGNING_PROPERTIES);
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env, APP_VARIANT: "production" };
// AppImage host library paths prevent CMake from locating its own installation.
delete env.APPIMAGE;
delete env.ARGV0;
delete env.APPDIR;
delete env.LD_LIBRARY_PATH;
const commands = [
  { command: process.execPath, args: ["editor/build.mjs"], cwd: root },
  {
    command: process.execPath,
    args: [
      require.resolve("expo/bin/cli"),
      "prebuild",
      "--platform",
      "android",
      "--no-install",
    ],
    cwd: root,
  },
  {
    command: "./gradlew",
    args: [":app:assembleRelease", "--no-daemon", "--max-workers=2"],
    cwd: `${root}/android`,
  },
];

for (const { command, args, cwd } of commands) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
