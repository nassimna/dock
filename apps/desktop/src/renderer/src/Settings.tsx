import { useState } from "react";
import { Bell, Download, Keyboard, Terminal } from "lucide-react";
import type { Settings as Preferences, Snapshot } from "@dock/contracts";
import { Shortcut } from "./components";
import type { Act, Dispatch } from "./state";

export function Settings({
  snapshot,
  dispatch,
  act,
}: {
  snapshot: Snapshot;
  dispatch: Dispatch;
  act: Act;
}) {
  const [draft, setDraft] = useState<Preferences>(snapshot.settings);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setStatus("Saving…");
    try {
      await dispatch({
        type: "settings.save",
        settings: { ...draft, theme: snapshot.settings.theme },
      });
      setStatus("Preferences saved.");
    } catch {
      setStatus("This update could not be saved.");
    }
  }
  function record(event: React.KeyboardEvent) {
    if (!recording) return;
    event.preventDefault();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      setStatus("Include Ctrl, Cmd, or Alt with your key.");
      return;
    }
    const key =
      event.code === "Space"
        ? "Space"
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key;
    const parts = [
      event.metaKey ? "Command" : "",
      event.ctrlKey ? "Control" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      key,
    ].filter(Boolean);
    setDraft({ ...draft, shortcut: parts.join("+") });
    setRecording(false);
    setStatus("Save preferences to register this shortcut.");
  }
  return (
    <form className="settings" onSubmit={(event) => void save(event)}>
      <section>
        <h2>
          <Keyboard size={17} /> Quick capture
        </h2>
        <p>Open a small capture window over the app you’re using.</p>
        <div className="shortcut-setting">
          <input
            aria-label="Global capture shortcut"
            value={draft.shortcut}
            onChange={(event) =>
              setDraft({ ...draft, shortcut: event.target.value })
            }
            maxLength={80}
          />
          <button
            className="secondary"
            type="button"
            aria-pressed={recording}
            onClick={() => setRecording(!recording)}
            onKeyDown={record}
          >
            {recording ? "Press your shortcut…" : "Record shortcut"}
          </button>
        </div>
        <small
          className={snapshot.system.shortcutRegistered ? "muted" : "overdue"}
        >
          Current: <Shortcut value={snapshot.settings.shortcut} /> ·{" "}
          {snapshot.system.shortcutRegistered
            ? "Registered with the system"
            : "Unavailable — choose another shortcut"}
        </small>
      </section>
      <section>
        <h2>
          <Bell size={17} /> Reminders
        </h2>
        <p>Notifications run while Dock is open or in the tray.</p>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.quietHours}
            onChange={(event) =>
              setDraft({ ...draft, quietHours: event.target.checked })
            }
          />{" "}
          Quiet hours
        </label>
        <div className="fields">
          <label className="field">
            From
            <input
              type="time"
              value={draft.quietStart}
              onChange={(event) =>
                setDraft({ ...draft, quietStart: event.target.value })
              }
              required
              disabled={!draft.quietHours}
            />
          </label>
          <label className="field">
            Until
            <input
              type="time"
              value={draft.quietEnd}
              onChange={(event) =>
                setDraft({ ...draft, quietEnd: event.target.value })
              }
              required
              disabled={!draft.quietHours}
            />
          </label>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={!snapshot.system.notificationsSupported}
          onClick={() => act({ type: "window", action: "test-notification" })}
        >
          Test notification
        </button>
        {snapshot.system.notificationError && (
          <p role="alert" className="note-error">
            Your system could not show the notification:{" "}
            {snapshot.system.notificationError}
          </p>
        )}
      </section>
      <section>
        <h2>Desktop behavior</h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.closeToTray}
            disabled={!snapshot.system.trayAvailable}
            onChange={(event) =>
              setDraft({ ...draft, closeToTray: event.target.checked })
            }
          />{" "}
          Keep running in the tray when the main window closes
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.launchAtLogin}
            disabled={!snapshot.system.launchAtLoginSupported}
            onChange={(event) =>
              setDraft({ ...draft, launchAtLogin: event.target.checked })
            }
          />{" "}
          Launch at login
        </label>
        {!snapshot.system.launchAtLoginSupported && (
          <small className="muted">
            Launch at login is available in packaged macOS and Windows builds.
          </small>
        )}
        {!snapshot.system.topmostSupported && (
          <p className="overdue">
            Wayland does not support the native always-on-top mini window.
          </p>
        )}
      </section>
      <div className="preferences-save">
        <span role="status">{status}</span>
        <button className="primary">Save preferences</button>
      </div>
      <section>
        <h2>
          <Download size={17} /> Your data
        </h2>
        <p>Stored on this computer. Cloud sync will be connected later.</p>
        <input
          className="data-path"
          aria-label="Database location"
          value={snapshot.system.dataPath}
          readOnly
        />
        <button
          type="button"
          className="secondary"
          onClick={() => act({ type: "window", action: "export" })}
        >
          Export a JSON backup
        </button>
      </section>
      <section>
        <h2>
          <Terminal size={17} /> Agent access
        </h2>
        <p>The local CLI reads and writes through the running app.</p>
        <pre>
          pnpm dock list --json{"\n"}pnpm dock add "Review the proposal" --space
          Work{"\n"}pnpm dock note "Call notes" --body "Follow up Friday"
        </pre>
        <small className="muted">
          Dock {snapshot.system.version} · Local desktop edition
        </small>
      </section>
    </form>
  );
}
