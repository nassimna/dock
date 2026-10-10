import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { Badge } from "@/components/ui/badge";
import { themePresets, themeStyle } from "@/lib/theme";
import { useState } from "react";
import { Bell, Download, Keyboard, Palette, Terminal } from "lucide-react";
import { settingsSchema, type Settings as Preferences, type Snapshot } from "@dock/contracts";
import { SyncSettings } from "./SyncSettings";
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
  const mode = snapshot.settings.theme;
  const colors = draft.themeColors[mode];
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const preferences = settingsSchema.safeParse({ ...draft, theme: mode, capturePinned: snapshot.settings.capturePinned });
    if (!preferences.success) {
      setStatus(preferences.error.issues[0]!.message);
      return;
    }
    setStatus("Saving…");
    try {
      const result = await dispatch({
        type: "settings.save",
        settings: preferences.data,
      });
      setDraft(result.settings);
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
    <div className="settings">
      <form onSubmit={(event) => void save(event)}>
        <div className="preferences-save">
          <span role="status">{status || "Changes apply when you save."}</span>
          <Button variant="default">Save preferences</Button>
        </div>
        <section>
          <h2><Palette size={17} /> Appearance</h2>
          <p>Make Dock yours. Preview your colors, then save them across your windows. Preferences stay on this device.</p>
          <div className="fields">
            <Label className="field">Theme
              <Select value={mode} onValueChange={theme => act({ type: "settings.save", settings: { ...snapshot.settings, theme: theme as Preferences["theme"] } })}>
                <SelectTrigger aria-label="Theme"><SelectValue /></SelectTrigger>
                <SelectContent position="popper"><SelectItem value="dark">Dark</SelectItem><SelectItem value="light">Light</SelectItem></SelectContent>
              </Select>
            </Label>
            <Label className="field">Layout density
              <Select value={draft.density} onValueChange={density => setDraft({ ...draft, density: density as Preferences["density"] })}>
                <SelectTrigger aria-label="Layout density"><SelectValue /></SelectTrigger>
                <SelectContent position="popper"><SelectItem value="compact">Compact</SelectItem><SelectItem value="comfortable">Comfortable</SelectItem></SelectContent>
              </Select>
            </Label>
            <Label className="field">Note font
              <Select value={draft.noteFont} onValueChange={noteFont => setDraft({ ...draft, noteFont: noteFont as Preferences["noteFont"] })}>
                <SelectTrigger aria-label="Note font"><SelectValue /></SelectTrigger>
                <SelectContent position="popper"><SelectItem value="system">System sans</SelectItem><SelectItem value="serif">Serif</SelectItem><SelectItem value="mono">Monospace</SelectItem></SelectContent>
              </Select>
            </Label>
            <Label className="field">Note text size
              <Select value={String(draft.noteSize)} onValueChange={noteSize => setDraft({ ...draft, noteSize: Number(noteSize) as Preferences["noteSize"] })}>
                <SelectTrigger aria-label="Note text size"><SelectValue /></SelectTrigger>
                <SelectContent position="popper"><SelectItem value="14">Small</SelectItem><SelectItem value="16">Standard</SelectItem><SelectItem value="18">Large</SelectItem></SelectContent>
              </Select>
            </Label>
          </div>
          <div className="theme-presets" role="group" aria-label="Color presets">
            {Object.entries(themePresets).map(([name, preset]) => <Button key={name} variant="outline" size="sm" type="button"
              aria-pressed={Object.entries(preset[mode]).every(([key, value]) => (colors[key as keyof typeof colors] ?? themePresets.Graphite[mode][key as keyof typeof colors]) === value)}
              onClick={() => setDraft({ ...draft, themeColors: preset })}>
              <span className="color-swatch" style={{ background: preset[mode].primary }} />{name}
            </Button>)}
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft({ ...draft, themeColors: { dark: {}, light: {} } })}>Reset colors</Button>
          </div>
          <div className="theme-colors">
            {([['background', 'Background'], ['card', 'Surfaces'], ['foreground', 'Text'], ['mutedForeground', 'Muted text'], ['border', 'Borders'], ['primary', 'Accent']] as const).map(([key, label]) =>
              <Label className="field" key={key}>{label}
                <div className="color-input">
                  <span className="color-swatch" style={{ background: colors[key] || themePresets.Graphite[mode][key] }} />
                  <Input aria-label={`${label} color`} value={colors[key] ?? ''} placeholder={themePresets.Graphite[mode][key]} maxLength={7} spellCheck={false}
                    onChange={event => setDraft({ ...draft, themeColors: { ...draft.themeColors, [mode]: { ...colors, [key]: event.target.value || undefined } } })} />
                </div>
              </Label>)}
          </div>
          <div className="theme-preview" style={themeStyle(mode, colors)}>
            <div><strong>Theme preview</strong><Badge>Work</Badge></div>
            <p>Your notes and tasks, in your colors.</p>
            <small>Editing {mode} colors. Light and dark palettes are saved separately.</small>
          </div>
        </section>
        <section>
          <h2>
            <Keyboard size={17} /> Quick capture
          </h2>
          <p>Open a small capture window over the app you’re using.</p>
          <div className="shortcut-setting">
            <Input
              aria-label="Global capture shortcut"
              value={draft.shortcut}
              onChange={(event) =>
                setDraft({ ...draft, shortcut: event.target.value })
              }
              maxLength={80}
            />
            <Button variant="outline"

              type="button"
              aria-pressed={recording}
              onClick={() => setRecording(!recording)}
              onKeyDown={record}
            >
              {recording ? "Press your shortcut…" : "Record shortcut"}
            </Button>
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
          <Label className="checkbox-label">
            <Checkbox
              checked={draft.quietHours}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, quietHours: checked === true })
              }
            />{" "}
            Quiet hours
          </Label>
          <div className="fields">
            <Label className="field">
              From
              <TimePicker label="Quiet hours from" value={draft.quietStart} onChange={quietStart => setDraft({ ...draft, quietStart })} disabled={!draft.quietHours} />
            </Label>
            <Label className="field">
              Until
              <TimePicker label="Quiet hours until" value={draft.quietEnd} onChange={quietEnd => setDraft({ ...draft, quietEnd })} disabled={!draft.quietHours} />
            </Label>
          </div>
          <Button variant="outline"
            type="button"

            disabled={!snapshot.system.notificationsSupported}
            onClick={() => act({ type: "window", action: "test-notification" })}
          >
            Test notification
          </Button>
          {snapshot.system.notificationError && (
            <p role="alert" className="note-error">
              Your system could not show the notification:{" "}
              {snapshot.system.notificationError}
            </p>
          )}
        </section>
        <section>
          <h2>Desktop behavior</h2>
          <Label className="checkbox-label">
            <Checkbox
              checked={draft.closeToTray}
              disabled={!snapshot.system.trayAvailable}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, closeToTray: checked === true })
              }
            />{" "}
            Keep running in the tray when the main window closes
          </Label>
          <Label className="checkbox-label">
            <Checkbox
              checked={draft.launchAtLogin}
              disabled={!snapshot.system.launchAtLoginSupported}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, launchAtLogin: checked === true })
              }
            />{" "}
            Launch at login
          </Label>
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
      </form>
      <SyncSettings sync={snapshot.sync} dispatch={dispatch} />
      <section>
        <h2>
          <Download size={17} /> Your data
        </h2>
        <p>
          Tasks, notes, and preferences are saved on this computer, even offline.
          Changes appear immediately in your other Dock windows. Connect your
          account above to sync with your other devices.
        </p>
        <Input
          className="data-path"
          aria-label="Database location"
          value={snapshot.system.dataPath}
          readOnly
        />
        <Button variant="outline"
          type="button"

          onClick={() => act({ type: "window", action: "export" })}
        >
          Export a JSON backup
        </Button>
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
    </div>
  );
}
