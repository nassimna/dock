import { spawn } from "node:child_process";

const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) throw new Error("Expected dev or start.");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  [
    "--filter",
    "@dock/desktop",
    "exec",
    "electron-vite",
    mode === "dev" ? "dev" : "preview",
  ],
  { env, stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
