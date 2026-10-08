import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const directoryIndex = args.indexOf("--data-dir");
let directory = process.env.DOCK_DATA_DIR;
if (directoryIndex !== -1) {
  directory = args[directoryIndex + 1];
  if (!directory || directory.startsWith("--"))
    fail("--data-dir needs a directory.");
  args.splice(directoryIndex, 2);
}
directory ??=
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Dock")
    : process.platform === "win32"
      ? join(
          process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
          "Dock",
        )
      : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Dock");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
function option(name, fallback = "") {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} needs a value.`);
  return value;
}

const verb = args[0];
if (!verb || verb === "help" || verb === "--help") {
  process.stdout.write(
    `Dock local CLI — keep the desktop app running.\n\n  list [--json] [--notes] [--done]\n  add "Task title" [--space Work] [--at ISO-date] [--repeat daily] [--important]\n  note "Note title" [--body "Details"] [--space Personal]\n  done ITEM-ID\n  delete ITEM-ID\n  snooze ITEM-ID [--minutes 10]\n  open | quick | mini\n\nUse --data-dir PATH for an isolated profile.\n`,
  );
  process.exit(0);
}
let command;
if (verb === "list") command = { type: "snapshot" };
else if (verb === "add" || verb === "note") {
  if (!args[1] || args[1].startsWith("--"))
    fail("Provide an item title in quotes.");
  const at = option("--at");
  if (at && !Number.isFinite(Date.parse(at)))
    fail("--at needs a valid date and time.");
  command = {
    type: "item.save",
    item: {
      kind: verb === "note" ? "note" : "task",
      title: args[1],
      body: option("--body"),
      space: option("--space", "Inbox"),
      priority: args.includes("--important"),
      scheduledAt: at ? new Date(at).toISOString() : null,
      recurrence: option("--repeat", "none"),
      linkedNoteId: null,
    },
  };
} else if (["done", "delete", "snooze"].includes(verb)) {
  if (!args[1]) fail("Provide an item ID from dock list.");
  command =
    verb === "snooze"
      ? {
          type: "item.snooze",
          id: args[1],
          minutes: Number(option("--minutes", "10")),
        }
      : {
          type: verb === "done" ? "item.complete" : "item.delete",
          id: args[1],
        };
} else if (["open", "quick", "mini"].includes(verb)) {
  command = {
    type: "window",
    action: verb === "open" ? "main" : verb === "quick" ? "capture" : "mini",
  };
} else fail(`Unknown command: ${verb}. Run pnpm dock help.`);

try {
  let descriptor;
  try {
    descriptor = JSON.parse(
      readFileSync(join(directory, "local-api.json"), "utf8"),
    );
  } catch {
    fail("Dock is not running in this profile. Start the desktop app first.");
  }
  const response = await fetch(`http://127.0.0.1:${descriptor.port}/commands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${descriptor.token}`,
    },
    body: JSON.stringify(command),
  });
  const result = await response.json();
  if (!response.ok) fail(result.error ?? "The command failed.");
  if (args.includes("--json"))
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (verb === "list") {
    const items = result.items.filter(
      (item) =>
        item.kind === (args.includes("--notes") ? "note" : "task") &&
        (args.includes("--done") || !item.done),
    );
    if (!items.length) process.stdout.write("No matching items.\n");
    for (const item of items)
      process.stdout.write(
        `${item.id}  ${item.done ? "[x]" : "[ ]"} ${item.title}  (${item.space})\n`,
      );
  } else process.stdout.write("Done.\n");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
