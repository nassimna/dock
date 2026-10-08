import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  FileText,
  Inbox,
  ListFilter,
  ListTodo,
  Maximize2,
  Minus,
  Moon,
  Pin,
  Plus,
  Search,
  Settings2,
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
import { Empty, Shortcut, TaskRow } from "./components";
import { Notes } from "./Notes";
import { Schedule } from "./Schedule";
import { Settings } from "./Settings";
import { TaskEditor } from "./TaskEditor";
import { useDock, type Act } from "./state";

type View =
  "today" | "inbox" | "all" | "notes" | "schedule" | "done" | "settings";
const navigation = [
  { id: "today", title: "Today", icon: Sun },
  { id: "inbox", title: "Inbox", icon: Inbox },
  { id: "all", title: "All tasks", icon: ListTodo },
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
  onSettings,
}: {
  snapshot: Snapshot;
  act: Act;
  onSearch: () => void;
  onSettings: () => void;
}) {
  return (
    <header className="chrome">
      <div className="chrome-brand">
        <ListFilter size={19} />
        <strong>Dock</strong>
        {role !== "main" && (
          <span>{role === "capture" ? "Quick capture" : "Mini window"}</span>
        )}
      </div>
      <div className="chrome-tools">
        {role === "main" && (
          <button
            className="icon-button"
            aria-label="Search tasks and notes"
            onClick={onSearch}
          >
            <Search size={17} />
          </button>
        )}
        <button
          className="icon-button"
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
        </button>
        {role === "main" && (
          <>
            <button
              className={`icon-button ${snapshot.system.miniOpen ? "active" : ""}`}
              aria-label="Open mini window"
              onClick={() => act({ type: "window", action: "mini" })}
            >
              <Pin size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Preferences"
              onClick={onSettings}
            >
              <Settings2 size={17} />
            </button>
          </>
        )}
        <div className="window-controls">
          {role !== "capture" && (
            <button
              className="icon-button"
              aria-label="Minimize window"
              onClick={() => act({ type: "window", action: "minimize" })}
            >
              <Minus size={15} />
            </button>
          )}
          {role === "main" && (
            <button
              className="icon-button"
              aria-label="Maximize window"
              onClick={() => act({ type: "window", action: "maximize" })}
            >
              <Maximize2 size={13} />
            </button>
          )}
          <button
            className="icon-button close-control"
            aria-label="Close window"
            onClick={() => act({ type: "window", action: "close" })}
          >
            <X size={16} />
          </button>
        </div>
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
  const [deleted, setDeleted] = useState<Item | null>(null);
  const [clock, setClock] = useState(Date.now());
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = snapshot?.settings.theme ?? "dark";
  }, [snapshot?.settings.theme]);
  useEffect(() => {
    if (searchOpen) search.current?.focus();
  }, [searchOpen]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
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
      setDeleted(item);
    } catch {
      /* The shared error banner reports the failure. */
    }
  }
  if (!snapshot)
    return (
      <div className="startup">
        <ListFilter size={28} />
        <h1>Dock</h1>
        <p role="status">{error || "Opening your local workspace…"}</p>
        {error && (
          <button
            className="secondary"
            onClick={() => act({ type: "snapshot" })}
          >
            Try again
          </button>
        )}
      </div>
    );
  const today = localDate(new Date(clock));
  const tasks = snapshot.items.filter(
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
      />
    ));

  return (
    <div className={`app-shell ${role}`}>
      <Chrome
        snapshot={snapshot}
        act={act}
        onSearch={() => {
          setSearchOpen(!searchOpen);
          if (view === "schedule" || view === "settings") setView("all");
        }}
        onSettings={() => setView("settings")}
      />
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={clearError}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {role === "capture" ? (
        <Capture snapshot={snapshot} dispatch={dispatch} act={act} />
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
              <button
                className="icon-button"
                aria-label="Open main app"
                onClick={() => act({ type: "window", action: "main" })}
              >
                <Maximize2 size={16} />
              </button>
            </div>
            {tasks.filter((item) => !item.done).slice(0, 6).length ? (
              rows(tasks.filter((item) => !item.done).slice(0, 6))
            ) : (
              <Empty title="Nothing to lose track of">
                Capture something to keep it nearby.
              </Empty>
            )}
          </div>
          <button
            className="inline-add mini-add"
            onClick={() => act({ type: "window", action: "capture" })}
          >
            <Plus size={17} /> Quick capture
          </button>
        </>
      ) : (
        <>
          <nav className="navigation" aria-label="App navigation">
            {navigation.map(({ id, title, icon: Icon }) => (
              <button
                key={id}
                className={`nav-button ${view === id ? "active" : ""}`}
                aria-current={view === id ? "page" : undefined}
                onClick={() => setView(id)}
              >
                <Icon size={15} />
                {title}
                {id === "inbox" && (
                  <small>
                    {snapshot.items.filter(
                      (item) =>
                        item.kind === "task" &&
                        !item.done &&
                        item.space === "Inbox",
                    ).length || ""}
                  </small>
                )}
              </button>
            ))}
          </nav>
          <main className="main">
            <div className="main-heading">
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
              {!["settings", "notes", "schedule"].includes(view) && (
                <div className="heading-tools">
                  <select
                    aria-label="Filter by space"
                    value={space}
                    onChange={(event) => setSpace(event.target.value)}
                  >
                    <option value="all">All spaces</option>
                    <option>Inbox</option>
                    <option>Work</option>
                    <option>Personal</option>
                  </select>
                  <button
                    className="icon-button"
                    aria-label="New task"
                    onClick={() => setEditing(null)}
                  >
                    <Plus size={19} />
                  </button>
                </div>
              )}
            </div>
            {searchOpen && view !== "settings" && (
              <div className="search">
                <Search size={17} />
                <input
                  ref={search}
                  aria-label="Search"
                  placeholder="Find a task or note…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    setSearchOpen(false);
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div hidden={view !== "notes"}>
              <Notes
                snapshot={snapshot}
                query={query}
                dispatch={dispatch}
                act={act}
                onTask={setEditing}
                onDelete={(item) => void remove(item)}
              />
            </div>
            {view === "schedule" ? (
              <Schedule snapshot={snapshot} act={act} onOpen={setEditing} />
            ) : view === "settings" ? (
              <Settings snapshot={snapshot} dispatch={dispatch} act={act} />
            ) : (
              view !== "notes" && (
                <>
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
                  <button
                    className="inline-add"
                    onClick={() => act({ type: "window", action: "capture" })}
                  >
                    <Plus size={17} />
                    <span>Add a task or note</span>
                    <Shortcut value={snapshot.settings.shortcut} />
                  </button>
                </>
              )
            )}
          </main>
          <footer className="foot">
            <span>
              <span className="status-dot" /> Local storage
            </span>
            <button onClick={() => act({ type: "window", action: "capture" })}>
              Quick capture <Shortcut value={snapshot.settings.shortcut} />
            </button>
          </footer>
        </>
      )}
      {deleted && (
        <div className="undo-toast" role="status">
          <span>{deleted.kind === "task" ? "Task" : "Note"} deleted</span>
          <button
            onClick={() =>
              void dispatch({ type: "item.restore", id: deleted.id })
                .then(() => setDeleted(null))
                .catch(() => {})
            }
          >
            Undo
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss undo"
            onClick={() => setDeleted(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {editing !== undefined && (
        <TaskEditor
          key={editing?.id ?? "new"}
          item={editing}
          snapshot={snapshot}
          dispatch={dispatch}
          onClose={() => setEditing(undefined)}
          onDelete={(item) => void remove(item)}
        />
      )}
    </div>
  );
}
