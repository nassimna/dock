import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimePicker } from "@/components/ui/time-picker";
import { floatingStyle } from "@/lib/theme";
import { useEffect, useState } from "react";
import { Bell, Download, Keyboard, ListFilter, Terminal, Palette, Monitor, UserRound, ChevronRight, Database, type LucideIcon } from "lucide-react";
import { floatingStyleSchema, settingsSchema, type Settings as Preferences, type Snapshot } from "@dock/contracts";
import { AppearanceSettings } from "./AppearanceSettings";
import { DataSettings } from "./DataSettings";
import { UpdateDetails } from "./Updates";
import { Shortcut } from "./components";
import type { Act, Dispatch } from "./state";

export function Settings({
  snapshot,
  dispatch,
  act,
  onAccount,
}: {
  snapshot: Snapshot;
  dispatch: Dispatch;
  act: Act;
  onAccount: () => void;
}) {
  const [category, setCategory] = useState("general");
  const [draft, setDraft] = useState<Preferences>(snapshot.settings);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  const mode = snapshot.settings.theme;
  const preferences = { ...draft, theme: mode, capturePinned: snapshot.settings.capturePinned, miniPinned: snapshot.settings.miniPinned };
  function patchFloating(patch: Partial<Preferences["floating"]>) {
    setDraft(current => ({ ...current, floating: { ...current.floating, ...patch } }));
  }
  const changed = JSON.stringify(preferences) !== JSON.stringify(snapshot.settings);
  useEffect(() => window.dock.onBeforeUpdate(async () => {
    if (changed) throw new Error("Wait for your preferences to finish saving before restarting Rivnote.");
  }));
  // Changes save automatically once input pauses; invalid values wait until they are corrected.
  useEffect(() => {
    if (!changed || recording) return;
    const parsed = settingsSchema.safeParse(preferences);
    if (!parsed.success) {
      setStatus(parsed.error.issues[0]!.message);
      return;
    }
    const timer = window.setTimeout(() => {
      setStatus("Saving…");
      dispatch({ type: "settings.save", settings: parsed.data })
        .then(() => setStatus("Preferences saved."))
        .catch(() => { setDraft(snapshot.settings); setStatus("This change could not be saved. Your previous preference is kept."); });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(preferences), recording]);
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

  }
  return (
    <div className="settings settings-workspace">
      <nav className="settings-nav" aria-label="Settings categories">
        {([
          ["general", "General", Monitor], ["appearance", "Appearance", Palette],
          ["floating", "Floating icon", ListFilter], ["notifications", "Notifications", Bell],
          ["data", "Data & backups", Database], ["updates", "Updates", Download],
        ] satisfies [string, string, LucideIcon][]).map(([id, title, Icon]) => <Button key={id} type="button" variant="ghost"
          aria-current={category === id ? "page" : undefined}
          onClick={() => { setCategory(id); setRecording(false); setStatus(""); }}>
          <Icon size="1rem" /><span>{title}</span>
        </Button>)}
      </nav>
      <div className="settings-content">
      {category === "general" && <button type="button" className="settings-account-card" onClick={onAccount}>
        <UserRound size={24} /><span><strong>{snapshot.sync.connected ? snapshot.sync.email : "Your Rivnote account"}</strong>
        <small>{snapshot.sync.connected ? "Sync, security and signed-in devices" : "Sign in to keep your notes and tasks with you"}</small></span><ChevronRight size={18} />
      </button>}
      <form onSubmit={event => event.preventDefault()}>
        {category !== "updates" && category !== "data" && <div className="preferences-save"><span role="status">{status || "Changes save automatically."}</span></div>}
        {category === "floating" && <section aria-label="Floating icon settings">
          <h2><ListFilter size="1.0625rem" /> Floating icon</h2>
          <p>Small and always available while Rivnote runs. Click to toggle tasks, or drag the icon to move it.</p>
          <div className="floating-settings-layout">
            <div className="fields">
              <Label className="field">Size · {draft.floating.size}px
                <Input type="range" className="floating-range" aria-label="Floating icon size" min={28} max={72} step={2}
                  value={draft.floating.size} onChange={event => patchFloating({ size: Number(event.target.value) })} />
              </Label>
              <Label className="field">Opacity · {Math.round(draft.floating.opacity * 100)}%
                <Input type="range" className="floating-range" aria-label="Floating icon opacity" min={30} max={100} step={5}
                  value={Math.round(draft.floating.opacity * 100)} onChange={event => patchFloating({ opacity: Number(event.target.value) / 100 })} />
              </Label>
              <Label className="field">Color
                <Input type="color" aria-label="Floating icon color" value={draft.floating.color}
                  onChange={event => patchFloating({ color: event.target.value })} />
              </Label>
              <div className="field"><Label htmlFor="floating-shape">Shape</Label>
                <Select value={draft.floating.shape} onValueChange={shape => patchFloating({ shape: shape as Preferences['floating']['shape'] })}>
                  <SelectTrigger id="floating-shape"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="circle">Circle</SelectItem><SelectItem value="rounded">Rounded square</SelectItem><SelectItem value="square">Square</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="floating-preview">
              <div className="floating-preview-surface"><div style={floatingStyle(draft.floating)} aria-hidden="true">
                <div className="floating-button"><span className="floating-brand" />
                  {draft.floating.showCount && <span className="floating-count">{Math.min(99, snapshot.items.filter(item => item.kind === 'task' && !item.done).length)}</span>}
                </div>
              </div></div>
              <small>Preview</small>
            </div>
          </div>
          <div className="floating-toggles">
            <Label className="checkbox-label"><Checkbox checked={draft.floating.persistent} onCheckedChange={value => patchFloating({ persistent: value === true })} />Keep icon visible while tasks are expanded</Label>
            <Label className="checkbox-label"><Checkbox checked={draft.floating.showCount} onCheckedChange={value => patchFloating({ showCount: value === true })} />Show task count on icon</Label>
            <Label className="checkbox-label"><Checkbox checked={draft.floating.showHandle} onCheckedChange={value => patchFloating({ showHandle: value === true })} />Show a separate drag handle</Label>
            <Label className="checkbox-label"><Checkbox checked={draft.floating.locked} onCheckedChange={value => patchFloating({ locked: value === true })} />Lock icon position</Label>
          </div>
          <div className="detail-line">
            <Button type="button" variant="outline" size="sm" onClick={() => act({ type: 'window', action: 'floating-reset' })}>Reset icon position</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(current => ({ ...current, floating: floatingStyleSchema.parse({}) }))}>Restore icon defaults</Button>
          </div>
          <small className="muted">Position and appearance are remembered. Minimizing the app or task panel keeps the icon available. Hide it explicitly from its right-click menu.</small>
        </section>}
        {category === "appearance" && <AppearanceSettings draft={draft} setDraft={setDraft} snapshot={snapshot} act={act} />}
        {category === "general" && <section>
          <h2>
            <Keyboard size="1.0625rem" /> Quick capture
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
        </section>}
        {category === "notifications" && <section>
          <h2>
            <Bell size="1.0625rem" /> Reminders
          </h2>
          <p>Notifications run while Rivnote is open or in the tray.</p>
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
        </section>}
        {category === "general" && <section>
          <h2>Desktop behavior</h2>
          <Label className="checkbox-label">
            <Checkbox checked={draft.rememberLastView} onCheckedChange={checked => setDraft({ ...draft, rememberLastView: checked === true })} />
            Remember last view
          </Label>
          <small className="muted">Reopen your last task view and keep each project’s list or board layout. Off by default.</small>
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
            Start Rivnote at login
          </Label>
          {!snapshot.system.launchAtLoginSupported && (
            <small className="muted">
              Launch at login is available in packaged macOS and Windows builds.
            </small>
          )}
          <Label className="checkbox-label">
            <Checkbox
              checked={draft.floatingAtStartup}
              onCheckedChange={checked => setDraft({ ...draft, floatingAtStartup: checked === true })}
            />{" "}
            Show floating icon when Rivnote starts
          </Label>
          <small className="muted">Click the icon to view tasks. Drag it to move, or right-click to customize.</small>
          <Label className="checkbox-label">
            <Checkbox
              checked={draft.openMiniAtStartup}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, openMiniAtStartup: checked === true })
              }
            />{" "}
            Open sticky window when Rivnote starts
          </Label>
          <small className="muted">
            Starts with tasks expanded. Use the sticky window’s pin to keep the panel above other apps.
            {snapshot.system.platform === "darwin" && " It stays on every desktop, pinned or unpinned."}
          </small>
          {!snapshot.system.topmostSupported && (
            <p className="overdue">
              Wayland does not support the native always-on-top mini window.
            </p>
          )}
        </section>}
        {category === "updates" && <section>
          <h2><Download size="1.0625rem" /> Updates</h2>
          <Label className="checkbox-label">
            <Checkbox checked={draft.automaticUpdates} disabled={snapshot.update.status === "unavailable"}
              onCheckedChange={checked => setDraft({ ...draft, automaticUpdates: checked === true })} />
            Check and download updates automatically
          </Label>
          <p>Rivnote only restarts when you choose to install an update.</p>
          <UpdateDetails update={snapshot.update} version={snapshot.system.version} act={act} />
        </section>}
      </form>
      {(category === "data" || category === "notifications") && <DataSettings snapshot={snapshot} dispatch={dispatch} section={category === "data" ? "backups" : "reminders"} />}
      {category === "data" && <><section>
        <h2>
          <Download size="1.0625rem" /> Your data
        </h2>
        <p>
          Tasks, notes, and preferences are saved on this computer, even offline.
          Changes appear immediately in your other Rivnote windows. Sign in to your
          account to sync with your other devices.
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
          <Terminal size="1.0625rem" /> Agent access
        </h2>
        <p>The local CLI reads and writes through the running app.</p>
        <pre>
          pnpm dock list --json{"\n"}pnpm dock add "Review the proposal" --space
          Work{"\n"}pnpm dock note "Call notes" --body "Follow up Friday"
        </pre>
        <small className="muted">
          Rivnote {snapshot.system.version} · Local desktop edition
        </small>
      </section></>}
      </div>
    </div>
  );
}
