import { _electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { once } from "node:events";

const execute = promisify(execFile);
const evidence =
  process.env.DOCK_EVIDENCE_DIR ?? resolve(".validation", "screenshots");
mkdirSync(evidence, { recursive: true });
mkdirSync(resolve(".validation"), { recursive: true });
const profile = mkdtempSync(resolve(".validation", "electron-"));
const require = createRequire(resolve("apps/desktop/package.json"));
const executablePath = require("electron");
const env = { ...process.env, DOCK_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const checks = [];
let application;
let display;

async function pick(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function launch() {
  application = await _electron.launch({
    executablePath,
    args: [resolve("apps/desktop")],
    chromiumSandbox: true,
    env,
    timeout: 30000,
  });
  application.on("window", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const page = await application.firstWindow();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  return page;
}
function passed(name) {
  checks.push(name);
  process.stdout.write(`PASS ${name}\n`);
}
async function state(page) {
  return page.evaluate(() => window.dock.dispatch({ type: "snapshot" }));
}
async function screenshot(page, filename) {
  const png = await application.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === url,
    );
    return (await window.capturePage()).toPNG().toString("base64");
  }, page.url());
  writeFileSync(join(evidence, filename), Buffer.from(png, "base64"));
}
async function cli(...args) {
  return execute(
    process.execPath,
    [resolve("apps/cli/src/index.mjs"), "--data-dir", profile, ...args],
    { env },
  );
}
async function hideAll() {
  await application.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.hide();
  });
}

try {
  if (process.platform === "linux") {
    let number = 170;
    while (
      existsSync(`/tmp/.X${number}-lock`) ||
      existsSync(`/tmp/.X11-unix/X${number}`)
    )
      number++;
    env.DISPLAY = `:${number}`;
    env.XDG_SESSION_TYPE = "x11";
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(profile, "unused-notification-bus")}`;
    display = spawn(
      "Xvfb",
      [env.DISPLAY, "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
      { stdio: "ignore" },
    );
    display.on("error", (error) => {
      errors.push(error.message);
    });
    for (
      let attempt = 0;
      attempt < 50 && !existsSync(`/tmp/.X11-unix/X${number}`);
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(
      existsSync(`/tmp/.X11-unix/X${number}`),
      "The isolated display must start",
    );
  }

  let main = await launch();
  assert.equal(application.process().spawnargs.includes("--no-sandbox"), false);
  assert.equal((await state(main)).items.length, 0);
  assert.deepEqual(
    await main.evaluate(() => ({
      node: typeof window.require,
      process: typeof window.process,
      bridge: Object.keys(window.dock).sort(),
    })),
    {
      node: "undefined",
      process: "undefined",
      bridge: ["dispatch", "moveFloating", "onBeforeUpdate", "onCapture", "onChanged", "onNavigate", "onOpenTask", "prepareUpdate", "setCaptureVisible"],
    },
  );
  await expect(main.getByText("A clear start to your day")).toBeVisible();
  passed("empty local database opens through the real Electron entry point");

  if (process.platform === "darwin") {
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes("window=main")).close());
  } else {
    await main.getByRole("button", { name: "Close window", exact: true }).click();
  }
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes("window=main"))
        .isVisible(),
    ),
    false,
  );
  await cli("open");
  await expect(
    main.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  passed("closing the main window keeps the app available in the tray");

  await main.getByRole("button", { name: "New task", exact: true }).click();
  const editor = main.getByRole("complementary", { name: "New task" });
  await editor.getByLabel("Title", { exact: true }).fill("Review the proposal");
  await editor.getByLabel("Notes", { exact: true }).fill("Prepare the next steps");
  await pick(main, "Priority", "P1");
  await main.getByRole("button", { name: "Schedule", exact: true }).click();
  await pick(main, "Schedule time hour", "23");
  await pick(main, "Schedule time minute", "50");
  await main.getByRole("dialog", { name: "Schedule picker" }).getByRole("button", { name: "Done", exact: true }).click();
  await pick(main, "Repeat", "Weekly");
  await main.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    main.getByText("Review the proposal", { exact: true }),
  ).toBeVisible();
  const original = (await state(main)).items.find(
    (item) => item.title === "Review the proposal",
  );
  assert.ok(original.task.priority === 1 && original.priority && original.recurrence === "weekly");
  passed("task editor saves priority, schedule, and recurrence");
  await main.getByRole("button", { name: "New task", exact: true }).click();
  await main
    .getByLabel("Title", { exact: true })
    .fill("Invalid recurring task");
  await main.getByRole("button", { name: "Schedule", exact: true }).click();
  await main.getByRole("button", { name: "Clear", exact: true }).click();
  await main.getByRole("dialog", { name: "Schedule picker" }).getByRole("button", { name: "Done", exact: true }).click();
  await pick(main, "Repeat", "Daily");
  await main.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(main.getByRole("complementary", { name: "New task" }).getByRole("alert")).toContainText(
    "Recurring tasks need a scheduled date.",
  );
  await main.getByRole("button", { name: "Close task details", exact: true }).click();
  await main.getByRole("button", { name: "Discard changes", exact: true }).click();
  await main
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  assert.equal((await state(main)).items.length, 1);
  passed(
    "invalid recurrence stays in the editor and cannot write invalid data",
  );

  if (process.platform === "linux") {
    await hideAll();
    assert.equal(
      await application.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getFocusedWindow() !== null,
      ),
      false,
    );
    const capturePromise = application.waitForEvent("window");
    await execute("xdotool", ["key", "ctrl+shift+space"], { env });
    const capture = await capturePromise;
    await expect(capture.getByLabel("Capture text")).toBeVisible();
    await expect(capture.getByLabel("Capture text")).toBeFocused();
    await capture.getByLabel("Capture text").fill("Keep this draft");
    await capture.getByLabel("Capture text").press("Escape");
    await execute("xdotool", ["key", "ctrl+shift+space"], { env });
    await expect(capture.getByLabel("Capture text")).toHaveValue(
      "Keep this draft",
    );
    await capture.getByLabel("Capture text").press("Enter");
    passed(
      "system hotkey opens capture without Dock focused; Escape retains its draft",
    );
    await cli("quick");
    await capture.getByLabel("Capture text").fill("x".repeat(501));
    await capture.getByLabel("Capture text").press("Enter");
    await expect(capture.getByRole("alert")).toContainText(
      "Keep the title to 500 characters",
    );
    await expect(capture.getByLabel("Capture text")).toHaveValue(
      "x".repeat(501),
    );
    await capture
      .getByRole("button", { name: "Dismiss error", exact: true })
      .click();
    passed(
      "capture validation preserves an invalid draft without truncating it",
    );
    await capture.getByRole("button", { name: "Note", exact: true }).click();
    await capture
      .getByLabel("Capture text")
      .fill("Friday call\nAgenda\nFollow up الجمعة");
    await capture.getByLabel("Capture text").press("Enter");
    passed(
      "native quick capture saves a multiline note to the shared SQLite owner",
    );
  } else {
    await cli("note", "Friday call", "--body", "Agenda\nFollow up الجمعة");
  }
  await cli("open");
  await main.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(main.getByLabel("Note title")).toHaveValue("Friday call");
  await main.getByLabel("Note body").fill("First draft");
  await main.getByLabel("Note body").fill("Second draft");
  await main
    .getByLabel("Note body")
    .fill("Agenda\nDecisions\nFollow up الجمعة");
  await expect(
    main.getByRole("status").filter({ hasText: process.platform === "darwin" ? "Saved on this Mac" : "Saved on this device" }),
  ).toBeVisible();
  assert.equal(
    (await state(main)).items.find((item) => item.kind === "note").body,
    "Agenda\n\nDecisions\n\nFollow up الجمعة",
  );
  passed("rapid note autosaves retain the last edit and Unicode content");
  await main
    .getByLabel("Note body")
    .fill("Agenda\nDecisions\nFollow up الجمعة\nLatest edit");
  await main.getByLabel("Note title").fill("");
  await expect(
    main.getByRole("alert").filter({ hasText: "Give the note a title" }),
  ).toBeVisible();
  await main.getByRole("navigation", { name: "App navigation" }).getByRole("button", { name: /^Today(?:\s|$)/ }).click();
  await main.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(main.getByLabel("Note title")).toHaveValue("");
  await expect(
    main.getByRole("status").filter({ hasText: "Not saved" }),
  ).toBeVisible();
  await main.getByLabel("Note title").fill("Friday call");
  await expect(
    main.getByRole("status").filter({ hasText: process.platform === "darwin" ? "Saved on this Mac" : "Saved on this device" }),
  ).toBeVisible();
  assert.equal(
    (await state(main)).items.find((item) => item.kind === "note").body,
    "Agenda\n\nDecisions\n\nFollow up الجمعة\n\nLatest edit",
  );
  passed(
    "an invalid note draft survives navigation and saves after correction",
  );
  await screenshot(main, "dock-notes.png");

  await main.getByRole("navigation", { name: "App navigation" }).getByRole("button", { name: /^Today(?:\s|$)/ }).click();
  await main
    .getByRole("button")
    .filter({ hasText: "Review the proposal" })
    .click();
  await pick(main, "Linked note", "Friday call");
  await main.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(
    main
      .getByRole("button")
      .filter({ hasText: "Review the proposal" })
      .getByText("Friday call", { exact: true }),
  ).toBeVisible();
  await screenshot(main, "dock-dark.png");
  passed("task and note links are visible in the desktop UI");

  await main.getByRole("button", { name: "Show floating tasks icon", exact: true }).click();
  const floating = application.windows().find(page => page.url().includes("window=floating"));
  assert.ok(floating);
  const miniPromise = application.waitForEvent("window");
  await floating.getByRole("button", { name: /^Show tasks/ }).click();
  const mini = await miniPromise;
  assert.ok(mini);
  await expect(
    mini.getByText("Review the proposal", { exact: true }),
  ).toBeVisible();
  assert.equal(
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes("window=mini"))
        .isAlwaysOnTop(),
    ),
    true,
  );
  await cli("add", "Book the appointment", "--space", "Personal");
  await expect(
    mini.getByText("Book the appointment", { exact: true }),
  ).toBeVisible();
  await screenshot(mini, "dock-mini.png");
  passed("the native always-on-top mini window receives real CLI changes");

  await main
    .getByRole("checkbox", { name: "Complete Review the proposal", exact: true })
    .click();
  const completed = await state(main);
  assert.equal(
    completed.items.find((item) => item.id === original.id).done,
    true,
  );
  assert.equal(
    completed.items.filter((item) => item.title === original.title).length,
    2,
  );
  await main.getByRole("navigation", { name: "App navigation" }).getByRole("button", { name: /^Done(?:\s|$)/ }).click();
  await main
    .getByRole("checkbox", { name: "Reopen Review the proposal", exact: true })
    .click();
  await main.getByRole("navigation", { name: "App navigation" }).getByRole("button", { name: /^Today(?:\s|$)/ }).click();
  await main
    .getByRole("checkbox", { name: "Complete Review the proposal", exact: true })
    .click();
  assert.equal(
    (await state(main)).items.filter((item) => item.title === original.title)
      .length,
    2,
  );
  await cli("done", original.id);
  assert.equal(
    (await state(main)).items.find((item) => item.id === original.id).done,
    true,
  );
  passed(
    "recurrence creates one follow-up; repeated CLI completion stays completed",
  );

  await main.getByRole("navigation", { name: "App navigation" }).getByRole("button", { name: /^All tasks(?:\s|$)/ }).click();
  await main
    .getByRole("button")
    .filter({ hasText: "Book the appointment" })
    .click();
  await main.getByRole("button", { name: "Delete task", exact: true }).click();
  await expect(
    main.getByRole("status").filter({ hasText: "Item deleted" }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    main.getByText("Book the appointment", { exact: true }),
  ).toBeVisible();
  const booked = (await state(main)).items.find((item) => item.title === "Book the appointment");
  await main.evaluate((id) => window.dock.dispatch({ type: "item.snooze", id, minutes: 10 }), booked.id);
  const snoozed = (await state(main)).items.find(
    (item) => item.title === "Book the appointment",
  );
  assert.ok(new Date(snoozed.scheduledAt).getTime() > Date.now() + 9 * 60000);
  passed("deletion can be undone and snooze sets a future reminder");

  await main
    .getByRole("button", { name: "Search tasks and notes", exact: true })
    .click();
  await main
    .getByRole("textbox", { name: "Search", exact: true })
    .fill("no matching task");
  await expect(main.getByText("No matches yet")).toBeVisible();
  await main.getByRole("button", { name: "Clear search", exact: true }).click();
  await main.getByRole("navigation", { name: "App navigation" }).getByRole("button", { name: /^Upcoming(?:\s|$)/ }).click();
  await main.getByRole("button", { name: "Month & list", exact: true }).click();
  await expect(
    main.getByRole("button", { name: "Go to the Next Month", exact: true }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Go to the Next Month", exact: true }).click();
  await main
    .getByRole("button", { name: "Go to the Previous Month", exact: true })
    .click();
  await screenshot(main, "dock-schedule.png");
  passed("search empty state and calendar navigation work");

  await main.getByRole("button", { name: "Preferences", exact: true }).click();
  await main
    .getByRole("textbox", { name: "Global capture shortcut", exact: true })
    .fill("Control+Alt+J");
  await expect(
    main.getByText("Preferences saved.", { exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await state(main)).settings.shortcut).toBe("Control+Alt+J");
  await application.evaluate(({ globalShortcut }) => {
    globalShortcut.register("Control+Alt+K", () => {});
  });
  await main
    .getByRole("textbox", { name: "Global capture shortcut", exact: true })
    .fill("Control+Alt+K");
  await expect(main.getByRole("alert")).toContainText(
    "Your previous shortcut is still active",
  );
  assert.equal((await state(main)).settings.shortcut, "Control+Alt+J");
  assert.equal(
    await application.evaluate(({ globalShortcut }) =>
      globalShortcut.isRegistered("Control+Alt+J"),
    ),
    true,
  );
  await application.evaluate(({ globalShortcut }) =>
    globalShortcut.unregister("Control+Alt+K"),
  );
  await main
    .getByRole("button", { name: "Dismiss error", exact: true })
    .click();
  await main
    .getByRole("textbox", { name: "Global capture shortcut", exact: true })
    .fill("Control+Alt+J");
  passed("an occupied shortcut fails visibly and keeps the previous binding");
  if (process.platform === "linux") {
    await hideAll();
    await execute("xdotool", ["key", "ctrl+alt+j"], { env });
    const capture = application
      .windows()
      .find((page) => page.url().includes("window=capture"));
    await expect(capture.getByLabel("Capture text")).toBeFocused();
    await screenshot(capture, "dock-capture.png");
    await cli("open");
  }
  passed(
    process.platform === "linux" ? "a custom shortcut registers with the OS and opens the actual capture window" : "a custom shortcut registers with the OS; physical key invocation is unverified",
  );

  await main
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  await expect(main.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(mini.locator("html")).toHaveAttribute("data-theme", "light");
  await main.getByRole("navigation", { name: "App navigation" }).getByRole("button", { name: /^All tasks(?:\s|$)/ }).click();
  await screenshot(main, "dock-light.png");
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes("window=main"))
      .setSize(680, 540),
  );
  assert.equal(
    await main.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await screenshot(main, "dock-compact.png");
  await expect(
    main.getByRole("button", { name: "New task", exact: true }),
  ).toBeInViewport();
  const expected = await state(main);
  passed("theme updates propagate to every window");

  await application.close();
  application = undefined;
  assert.equal(existsSync(join(profile, "local-api.json")), false);
  main = await launch();
  const restored = await state(main);
  assert.deepEqual(restored.items, expected.items);
  assert.equal(restored.settings.theme, "light");
  assert.equal(restored.settings.shortcut, "Control+Alt+J");
  assert.equal(restored.system.shortcutRegistered, true);
  const listed = JSON.parse((await cli("list", "--json")).stdout);
  assert.deepEqual(listed.items, restored.items);
  passed(
    "items, notes, theme, and custom shortcut survive a complete app restart",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    join(evidence, "results.json"),
    JSON.stringify(
      {
        checks,
        errors,
        platform: process.platform,
        notificationDelivery:
          "Not verified; an isolated notification bus prevents user-facing alerts.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (application) {
    for (const [index, page] of application.windows().entries()) {
      if (!page.isClosed())
        await page
          .screenshot({ path: join(evidence, `failure-${index}.png`) })
          .catch(() => {});
    }
  }
  throw error;
} finally {
  try {
    if (application) await application.close();
  } finally {
    if (display?.pid && display.exitCode === null) {
      display.kill("SIGTERM");
      await once(display, "exit");
    }
    rmSync(profile, { recursive: true });
  }
}
