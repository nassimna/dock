import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { themeStyle } from "@/lib/theme";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Circle,
  Check,
  FileText,
  Inbox,
  ListFilter,
  ListTodo,
  Maximize2,
  Minus,
  Moon,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Star,
  Zap,
  Sun,
  X,
} from "lucide-react";
import {
  localDate,
  type Item,
  type Snapshot,
  type WindowRole,
} from "@dock/contracts";
import { Capture } from "./Capture";
import { ActionButton, Empty, Shortcut, TaskRow, todaySchedule } from "./components";
import { Notes } from "./Notes";
import { Schedule } from "./Schedule";
import { Settings } from "./Settings";
import { TaskEditor } from "./TaskEditor";
import { useDock, type Act } from "./state";

type View =
  "today" | "inbox" | "all" | "starred" | "notes" | "schedule" | "done" | "settings";
const navigation = [
  { id: "today", title: "Today", icon: Sun },
  { id: "inbox", title: "Inbox", icon: Inbox },
  { id: "all", title: "All tasks", icon: ListTodo },
  { id: "starred", title: "Starred", icon: Star },
  { id: "notes", title: "Notes", icon: FileText },
  { id: "schedule", title: "Schedule", icon: CalendarDays },
  { id: "done", title: "Done", icon: Check },
] as const;
const role = (new URLSearchParams(location.search).get("window") ??
  "main") as WindowRole;

function Chrome({
  snapshot,
  act,
  onSearch,
}: {
  snapshot: Snapshot;
  act: Act;
  onSearch: () => void;
}) {
  const capturePinned = snapshot.settings.capturePinned && snapshot.system.topmostSupported;
  return (
    <header className="chrome">
      <div className="chrome-brand">
        {role === "capture" ? <Zap size={16} /> : <ListFilter size={19} />}
        <strong>{role === "capture" ? "Quick capture" : "Dock"}</strong>
        {role === "mini" && <span>Mini window</span>}
        {role === "capture" && <Shortcut value={snapshot.settings.shortcut} />}
      </div>
      <div className="chrome-tools">
        {role === "main" && <Button variant="secondary" size="sm" className="chrome-capture"
          onClick={() => act({ type: "window", action: "capture" })}>
          <Zap size={15} /><span>Quick capture</span><Shortcut value={snapshot.settings.shortcut} />
        </Button>}
        {role === "main" && (
          <ActionButton
            aria-label="Search tasks and notes"
            onClick={onSearch}
          >
            <Search size={17} />
          </ActionButton>
        )}
        {role !== "capture" && <ActionButton
          aria-label={`Switch to ${snapshot.settings.theme === "dark" ? "light" : "dark"} mode`}
          onClick={() =>
            act({
              type: "settings.save",
              settings: {
                ...snapshot.settings,
                theme: snapshot.settings.theme === "dark" ? "light" : "dark",
              },
            })
          }
        >
          {snapshot.settings.theme === "dark" ? (
            <Sun size={17} />
          ) : (
            <Moon size={17} />
          )}
        </ActionButton>}
        {role === "main" && (
          <>
            <ActionButton className={`${snapshot.system.miniOpen ? "active" : ""}`}
              aria-label="Open mini window"
              onClick={() => act({ type: "window", action: "mini" })}
            >
              <Pin size={17} />
            </ActionButton>

          </>
        )}
        {role === "capture" && <>
          <ActionButton
            className={capturePinned ? "active" : ""}
            aria-label={!snapshot.system.topmostSupported ? "Pinning is unavailable on this desktop" : capturePinned ? "Unpin quick capture" : "Pin quick capture"}
            aria-pressed={capturePinned}
            disabled={!snapshot.system.topmostSupported}
            onClick={() => act({
              type: "settings.save",
              settings: { ...snapshot.settings, capturePinned: !snapshot.settings.capturePinned },
            })}
          >
            {capturePinned ? <Pin size={17} /> : <PinOff size={17} />}
          </ActionButton>
          <ActionButton aria-label="Dismiss quick capture" onClick={() => act({ type: "window", action: "hide" })}>
            <X size={16} />
          </ActionButton>
        </>}
        {snapshot.system.platform !== "darwin" && role !== "capture" && (
          <div className="window-controls">
            <ActionButton
              aria-label="Minimize window"
              onClick={() => act({ type: "window", action: "minimize" })}
            >
              <Minus size={15} />
            </ActionButton>
            {role === "main" && (
              <ActionButton
                aria-label="Maximize window"
                onClick={() => act({ type: "window", action: "maximize" })}
              >
                <Maximize2 size={13} />
              </ActionButton>
            )}
            <Button variant="ghost"
              className="icon-button close-control"
              aria-label="Close window"
              onClick={() => act({ type: "window", action: "close" })}
            >
              <X size={16} />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}

export function App() {
  const { snapshot, dispatch, act, error, clearError } = useDock();
  const [view, setView] = useState<View>("today");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [space, setSpace] = useState("all");
  const [editing, setEditing] = useState<Item | null | undefined>(undefined);
  const [feedback, setFeedback] = useState<{ type: "deleted" | "completed"; item: Item } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [completions, setCompletions] = useState<Record<string, { item: Item; phase: "saving" | "complete" }>>({});
  const completionTimers = useRef(new Map<string, number>());
  const [captureTitle, setCaptureTitle] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const search = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  useEffect(() => () => {
    completionTimers.current.forEach(timer => window.clearTimeout(timer));
  }, []);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [view, space]);
  useEffect(() => {
    document.documentElement.dataset.theme = snapshot?.settings.theme ?? "dark";
    document.documentElement.dataset.density = snapshot?.settings.density ?? "compact";
    document.documentElement.dataset.window = role;
    document.documentElement.dataset.noteFont = snapshot?.settings.noteFont ?? "system";
    document.documentElement.style.setProperty("--note-font-size", `${(snapshot?.settings.noteSize ?? 16) / 16}rem`);
    if (snapshot) {
      for (const [property, value] of Object.entries(themeStyle(snapshot.settings.theme, snapshot.settings.themeColors[snapshot.settings.theme]))) {
        document.documentElement.style.setProperty(property, String(value));
      }
    }
  }, [snapshot?.settings.theme, snapshot?.settings.themeColors, snapshot?.settings.density, snapshot?.settings.noteFont, snapshot?.settings.noteSize]);
  useEffect(() => {
    if (searchOpen) search.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        role === "main" &&
        editing === undefined
      ) {
        event.preventDefault();
        setSearchOpen(true);
        if (view === "schedule" || view === "settings") setView("all");
      }
      if (event.key === "Escape" && editing === undefined) {
        if (role === "capture") act({ type: "window", action: "hide" });
        else {
          setSearchOpen(false);
          setQuery("");
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [act, editing, view]);

  async function remove(item: Item) {
    try {
      await dispatch({ type: "item.delete", id: item.id });
      setEditing(undefined);
      setFeedback({ type: "deleted", item });
    } catch {
      /* The shared error banner reports the failure. */
    }
  }
  function clearCompletion(id: string) {
    window.clearTimeout(completionTimers.current.get(id));
    completionTimers.current.delete(id);
    setCompletions(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }
  async function toggleTask(item: Item) {
    if (completions[item.id]) return;
    setCompletions(current => ({ ...current, [item.id]: { item, phase: "saving" } }));
    try {
      await dispatch({ type: item.done ? "item.toggle" : "item.complete", id: item.id });
      if (item.done) {
        clearCompletion(item.id);
        setFeedback(current => current?.type === "completed" && current.item.id === item.id ? null : current);
      } else {
        setCompletions(current => ({ ...current, [item.id]: { item, phase: "complete" } }));
        setFeedback({ type: "completed", item });
        completionTimers.current.set(item.id, window.setTimeout(() => clearCompletion(item.id), 480));
      }
    } catch {
      clearCompletion(item.id);
    }
  }
  async function undoFeedback() {
    if (!feedback || undoing) return;
    setUndoing(true);
    try {
      if (feedback.type === "deleted") {
        await dispatch({ type: "item.restore", id: feedback.item.id });
      } else if (snapshot?.items.find(item => item.id === feedback.item.id)?.done) {
        await dispatch({ type: "item.toggle", id: feedback.item.id });
        clearCompletion(feedback.item.id);
      }
      setFeedback(current => current === feedback ? null : current);
    } catch {
      /* The shared error banner reports the failure; Undo remains available. */
    } finally {
      setUndoing(false);
    }
  }
  if (!snapshot)
    return (
      <div className="startup">
        <ListFilter size={28} />
        <h1>Dock</h1>
        <p role="status">{error || "Opening your local workspace…"}</p>
        {error && (
          <Button variant="outline"

            onClick={() => act({ type: "snapshot" })}
          >
            Try again
          </Button>
        )}
      </div>
    );
  const today = localDate(new Date(clock));
  const displayItems = snapshot.items.map(item => completions[item.id]?.item ?? item);
  const tasks = displayItems.filter(
    (item) =>
      item.kind === "task" &&
      (space === "all" || item.space === space) &&
      `${item.title} ${item.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  const visible = tasks
    .filter((item) => {
      if (view === "done") return item.done;
      if (item.done) return false;
      if (query) return true;
      if (view === "today")
        return (
          item.scheduledAt && localDate(new Date(item.scheduledAt)) <= today
        );
      if (view === "inbox") return item.space === "Inbox";
      if (view === "starred") return item.priority;
      return true;
    })
    .sort(
      (a, b) =>
        Number(b.priority) - Number(a.priority) ||
        (a.scheduledAt ?? "z").localeCompare(b.scheduledAt ?? "z"),
    );
  const overdue = visible.filter(
    (item) =>
      item.scheduledAt &&
      localDate(new Date(item.scheduledAt)) < today &&
      !item.done,
  );
  const remaining = visible.filter((item) => !overdue.includes(item));
  const defaults = {
    space: view === "inbox" || space === "all" ? "Inbox" as const : space as Item["space"],
    scheduledAt: view === "today" ? todaySchedule() : null,
    priority: view === "starred",
  };
  async function captureTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captureTitle.trim()) return;
    setCapturing(true);
    try {
      await dispatch({ type: "item.save", item: {
        kind: "task", title: captureTitle, body: "", ...defaults,
        recurrence: "none", linkedNoteId: null,
      } });
      setCaptureTitle("");
    } catch {
      /* The shared error banner reports the failure and the draft stays here. */
    } finally { setCapturing(false); }
  }
  const title =
    view === "settings"
      ? "Preferences"
      : navigation.find((item) => item.id === view)!.title;
  const rows = (items: Item[]) =>
    items.map((item) => (
      <TaskRow
        key={item.id}
        item={item}
        snapshot={snapshot}
        act={act}
        onOpen={setEditing}
        onToggle={item => void toggleTask(item)}
        completion={completions[item.id]?.phase}
      />
    ));

  return (
    <div
      className={`app-shell ${role} ${snapshot.system.platform === "darwin" ? "mac" : ""}`}
    >
      <Chrome
        snapshot={snapshot}
        act={act}
        onSearch={() => {
          setSearchOpen(!searchOpen);
          if (view === "schedule" || view === "settings") setView("all");
        }}
      />
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <ActionButton
            aria-label="Dismiss error"
            onClick={clearError}
          >
            <X size={15} />
          </ActionButton>
        </div>
      )}
      {role === "capture" ? (
        <Capture dispatch={dispatch} act={act} />
      ) : role === "mini" ? (
        <>
          <div className="mini-body">
            <div className="main-heading">
              <div>
                <h1>Keep it in view</h1>
                <p>
                  {snapshot.system.topmostSupported
                    ? "Pinned above your other windows"
                    : "Always-on-top unavailable on Wayland"}
                </p>
              </div>
              <ActionButton
                aria-label="Open main app"
                onClick={() => act({ type: "window", action: "main" })}
              >
                <Maximize2 size={16} />
              </ActionButton>
            </div>
            {tasks.filter((item) => !item.done).slice(0, 6).length ? (
              rows(tasks.filter((item) => !item.done).slice(0, 6))
            ) : (
              <Empty title="Nothing to lose track of">
                Capture something to keep it nearby.
              </Empty>
            )}
          </div>
          <Button variant="ghost"
            className="inline-add mini-add"
            onClick={() => act({ type: "window", action: "capture" })}
          >
            <Plus size={17} /> Quick capture
          </Button>
        </>
      ) : (
        <>
          <div className="workspace">
          <aside className="sidebar">
            <div className="sidebar-sections">
            <div className="sidebar-label">Workspace</div>
            <nav className="navigation" aria-label="App navigation">
              {navigation.map(({ id, title, icon: Icon }) => {
                const count = snapshot.items.filter(item => item.kind === "task" &&
                  (id === "done" ? item.done : !item.done) &&
                  (id === "today" ? item.scheduledAt && localDate(new Date(item.scheduledAt)) <= today :
                   id === "inbox" ? item.space === "Inbox" : id === "starred" ? item.priority : true)).length;
                return (
                  <Button variant="ghost" key={id} className={`nav-button ${view === id && (view !== "all" || space === "all") ? "active" : ""}`}
                    aria-current={view === id && (view !== "all" || space === "all") ? "page" : undefined}
                    onClick={() => { setView(id); setSpace("all"); }}>
                    <Icon size={16} /><span>{title}</span>
                    {!["notes", "schedule"].includes(id) && count > 0 && <Badge variant="secondary" className="nav-count">{count}</Badge>}
                  </Button>
                );
              })}
            </nav>
            <Separator className="my-2" />
            <div className="sidebar-label">Spaces</div>
            <nav className="space-navigation" aria-label="Spaces">
              {(["Work", "Personal"] as const).map(name => (
                <Button variant="ghost" key={name} className={`nav-button ${view === "all" && space === name ? "active" : ""}`}
                  aria-current={view === "all" && space === name ? "page" : undefined}
                  onClick={() => { setSpace(name); setView("all"); }}>
                  <Circle size={10} /><span>{name}</span>
                  <small>{snapshot.items.filter(item => item.kind === "task" && !item.done && item.space === name).length || ""}</small>
                </Button>
              ))}
            </nav>
            </div>
            <div className="sidebar-bottom">
              <Button variant="ghost" className="nav-button" onClick={() => act({ type: "window", action: "capture" })}>
                <Zap size={16} /><span>Quick capture</span>
              </Button>
              <Button variant="ghost" className={`nav-button ${view === "settings" ? "active" : ""}`}
                aria-current={view === "settings" ? "page" : undefined}
                onClick={() => setView("settings")}>
                <Settings2 size={16} /><span>Preferences</span>
              </Button>
            </div>
          </aside>
          <main ref={main} className="main">
            {view !== "notes" && <div className="main-heading">
              <div>
                <h1>
                  {query && !["settings", "notes", "schedule"].includes(view)
                    ? "Search results"
                    : title}
                </h1>
                <p>
                  {view === "today"
                    ? new Date(clock).toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })
                    : view === "inbox"
                      ? "Capture first. Organize when you’re ready."
                      : view === "all"
                        ? "Everything you’ve committed to."
                        : view === "done"
                          ? "A little proof of progress."
                          : ""}
                </p>
              </div>
              {!["settings", "notes", "schedule", "done"].includes(view) && (
                <div className="heading-tools">
                  <Select value={space} onValueChange={setSpace}>
                    <SelectTrigger aria-label="Filter by space"><SelectValue /></SelectTrigger>
                    <SelectContent position="popper">
                      <SelectItem value="all">All spaces</SelectItem>
                      <SelectItem value="Inbox">Inbox</SelectItem>
                      <SelectItem value="Work">Work</SelectItem>
                      <SelectItem value="Personal">Personal</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="default"

                    aria-label="New task"
                    onClick={() => setEditing(null)}
                  >
                    <Plus size={16} /> New task
                  </Button>
                </div>
              )}
            </div>}
            {searchOpen && view !== "settings" && (
              <div className="search">
                <Search size={17} />
                <Input
                  ref={search}
                  aria-label="Search"
                  placeholder="Find a task or note…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <ActionButton
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    setSearchOpen(false);
                  }}
                >
                  <X size={15} />
                </ActionButton>
              </div>
            )}
            <div hidden={view !== "notes"}>
              <Notes
                snapshot={snapshot}
                query={query}
                dispatch={dispatch}
                onTask={setEditing}
                onDelete={(item) => void remove(item)}
              />
            </div>
            {view === "schedule" ? (
              <Schedule items={displayItems} renderTasks={rows} />
            ) : view === "settings" ? (
              <Settings snapshot={snapshot} dispatch={dispatch} act={act} />
            ) : (
              view !== "notes" && (
                <>
                  {view !== "done" && !query && (
                    <form className="quick-add" onSubmit={event => void captureTask(event)}>
                      <Plus size={16} />
                      <Input aria-label="Quick add task" placeholder={view === "today" ? "Add a task for today…" : "Add a task…"}
                        value={captureTitle} onChange={event => setCaptureTitle(event.target.value)} required maxLength={500} disabled={capturing} />
                      <Button variant="outline" type="submit"  disabled={capturing || !captureTitle.trim()}>{capturing ? "Saving…" : "Add"}</Button>
                    </form>
                  )}
                  {!!overdue.length && (
                    <>
                      <div className="group-label overdue">
                        <span>Overdue</span>
                        <span>{overdue.length}</span>
                      </div>
                      {rows(overdue)}
                    </>
                  )}
                  {!!remaining.length && (
                    <>
                      <div className="group-label">
                        <span>
                          {view === "today" && !query
                            ? "For today"
                            : view === "done"
                              ? "Completed"
                              : "Tasks"}
                        </span>
                        <span>{remaining.length}</span>
                      </div>
                      {rows(remaining)}
                    </>
                  )}
                  {!visible.length && (
                    <Empty
                      title={
                        query
                          ? "No matches yet"
                          : view === "today"
                            ? "A clear start to your day"
                            : view === "done"
                              ? "Progress starts with one task"
                              : "Catch it before you forget"
                      }
                    >
                      {query
                        ? "Try another search or space."
                        : view === "today"
                          ? "Schedule a task for today, or capture something for later."
                          : "Use quick capture to add a task or note."}
                    </Empty>
                  )}

                </>
              )
            )}
          </main>
          </div>
          <footer className="foot">
            <span>
              <span className="status-dot" /> Saved on this{" "}
              {snapshot.system.platform === "darwin" ? "Mac" : "computer"} · Works
              offline
              {snapshot.sync.connected && (
                <Button variant="ghost" className="sync-status" onClick={() => setView("settings")}>
                  · {snapshot.sync.conflicts ? "Review conflicts" : snapshot.sync.phase === "synced" ? "Synced" :
                    snapshot.sync.phase === "syncing" ? "Syncing…" : snapshot.sync.phase === "offline" ? "Offline" :
                    snapshot.sync.phase === "error" ? "Sync needs attention" : "Sync pending"}
                </Button>
              )}
            </span>
            <Button variant="ghost" onClick={() => act({ type: "window", action: "capture" })}>
              Quick capture <Shortcut value={snapshot.settings.shortcut} />
            </Button>
          </footer>
        </>
      )}
      {feedback && (
        <div key={`${feedback.type}-${feedback.item.id}`}
          className={`undo-toast ${feedback.type === "completed" ? "completion-toast" : ""}`} role="status">
          {feedback.type === "completed" ? <>
            <Check className="completion-check" size={18} aria-hidden="true" />
            <span className="completion-message"><strong>Task completed</strong><span>{feedback.item.title}</span></span>
          </> : <span>{feedback.item.kind === "task" ? "Task" : "Note"} deleted</span>}
          <Button variant="ghost"
            disabled={undoing}
            onClick={() => void undoFeedback()}
          >
            Undo
          </Button>
          <ActionButton
            aria-label="Dismiss undo"
            onClick={() => setFeedback(null)}
          >
            <X size={14} />
          </ActionButton>
        </div>
      )}
      {editing !== undefined && (
        <TaskEditor
          key={editing?.id ?? "new"}
          item={editing}
          defaults={defaults}
          snapshot={snapshot}
          dispatch={dispatch}
          onClose={() => setEditing(undefined)}
          onDelete={(item) => void remove(item)}
        />
      )}
    </div>
  );
}
