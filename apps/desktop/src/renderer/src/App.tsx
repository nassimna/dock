import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { floatingStyle, themeStyle } from "@/lib/theme";
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  CalendarDays,
  BarChart3,
  Filter,
  GripHorizontal,
  Hash,
  LayoutGrid,
  List,
  Pencil,
  Trash2,
  Copy,
  Check,
  FileText,
  Flag,
  Inbox,
  ListFilter,
  ListTodo,
  Maximize2,
  Minus,
  Minimize2,
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
  taskPropertiesSchema,
  type Item,
  type Snapshot,
  type Project,
  type TaskProperties,
  type WindowRole,
} from "@dock/contracts";
import { Capture } from "./Capture";
import { ActionButton, Empty, RecognizedTokens, Shortcut, TaskRow, todaySchedule } from "./components";
const Notes = lazy(() => import("./Notes").then(module => ({ default: module.Notes })));
import { Schedule } from "./Schedule";
import { Settings } from "./Settings";
import { TaskEditor } from "./TaskEditor";
import { compileFilter, compileSearch, taskComparator, parseTaskText } from "./lib/tasks";
import { ProjectEditor, Filters, Templates, CommandMenu } from "./WorkspaceTools";
import { ProjectBoard, Progress, RecentlyDeleted } from "./TaskViews";
import { SharedProjectSettings } from "./SharedProjectSettings";
import { UpdateNotice } from "./Updates";
import { SyncConflicts } from "./SyncConflicts";
import { useDock, type Act } from "./state";
import brandMark from "../../../resources/brand.svg";

type View =
  "today" | "inbox" | "all" | "starred" | "notes" | "schedule" | "done" | "settings" | "project" | "filters" | "filter" | "progress" | "trash";
const noChildren: readonly Item[] = [];
const navigation = [
  { id: "today", title: "Today", icon: Sun },
  { id: "inbox", title: "Inbox", icon: Inbox },
  { id: "all", title: "All tasks", icon: ListTodo },
  { id: "starred", title: "Priority", icon: Flag },
  { id: "notes", title: "Notes", icon: FileText },
  { id: "schedule", title: "Upcoming", icon: CalendarDays },
  { id: "filters", title: "Filters & labels", icon: Filter },
  { id: "progress", title: "Progress", icon: BarChart3 },
  { id: "done", title: "Done", icon: Check },
] as const;
const role = (new URLSearchParams(location.search).get("window") ??
  "main") as WindowRole;
/** Today shows tasks scheduled or due by a deadline on or before today. */
const dueBy = (item: Item, day: string) =>
  [item.scheduledAt, item.task.deadline].some(value => value && localDate(new Date(value)) <= day);
const editableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox'], .task-panel");

function Chrome({
  snapshot,
  act,
  onSearch,
}: {
  snapshot: Snapshot;
  act: Act;
  onSearch: () => void;
}) {
  const pinned = (role === "mini" ? snapshot.settings.miniPinned : snapshot.settings.capturePinned) && snapshot.system.topmostSupported;
  const pinTarget = role === "mini" ? "sticky window" : "quick capture";
  return (
    <header className="chrome">
      <div className="chrome-brand">
        {role === "capture" ? <Zap size="1rem" /> : <img className="brand-mark" src={brandMark} alt="" />}
        <strong>{role === "capture" ? "Quick capture" : role === "mini" ? "Sticky window" : snapshot.system.name}</strong>
        {role === "capture" && <Shortcut value={snapshot.settings.shortcut} />}
      </div>
      <div className="chrome-tools">
        {role === "main" && <UpdateNotice update={snapshot.update} version={snapshot.system.version} act={act} />}
        {role === "main" && <Button variant="secondary" size="sm" className="chrome-capture"
          onClick={() => act({ type: "window", action: "capture" })}>
          <Zap size="0.9375rem" /><span>Quick capture</span><Shortcut value={snapshot.settings.shortcut} />
        </Button>}
        {role === "main" && (
          <ActionButton
            aria-label="Search tasks and notes"
            onClick={onSearch}
          >
            <Search size="1.0625rem" />
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
            <Sun size="1.0625rem" />
          ) : (
            <Moon size="1.0625rem" />
          )}
        </ActionButton>}
        {role === "main" && (
          <>
            <ActionButton className={`${snapshot.system.miniOpen ? "active" : ""}`}
              aria-label="Show floating tasks icon"
              onClick={() => act({ type: "window", action: "floating" })}
            >
              <Pin size="1.0625rem" />
            </ActionButton>

          </>
        )}
        {(role === "capture" || role === "mini") &&
          <ActionButton
            className={pinned ? "active" : ""}
            aria-label={!snapshot.system.topmostSupported ? "Pinning is unavailable on this desktop" : `${pinned ? "Unpin" : "Pin"} ${pinTarget}`}
            aria-pressed={pinned}
            disabled={!snapshot.system.topmostSupported}
            onClick={() => act({
              type: "settings.save",
              settings: { ...snapshot.settings, [role === "mini" ? "miniPinned" : "capturePinned"]: !pinned },
            })}
          >
            {pinned ? <Pin size="1.0625rem" /> : <PinOff size="1.0625rem" />}
          </ActionButton>
        }
        {role === "capture" &&
          <ActionButton aria-label="Dismiss quick capture" onClick={() => act({ type: "window", action: "hide" })}>
            <X size="1rem" />
          </ActionButton>
        }
        {snapshot.system.platform !== "darwin" && role !== "capture" && (
          <div className="window-controls">
            <ActionButton
              aria-label="Minimize window"
              onClick={() => act({ type: "window", action: "minimize" })}
            >
              <Minus size="0.9375rem" />
            </ActionButton>
            {role === "main" && (
              <ActionButton
                aria-label="Maximize window"
                onClick={() => act({ type: "window", action: "maximize" })}
              >
                <Maximize2 size="0.8125rem" />
              </ActionButton>
            )}
            <Button variant="ghost"
              className="icon-button close-control"
              aria-label="Close window"
              onClick={() => act({ type: "window", action: "close" })}
            >
              <X size="1rem" />
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
  const [notesMounted, setNotesMounted] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [taskLimit, setTaskLimit] = useState(100);
  useEffect(() => { if (view === "notes") setNotesMounted(true); }, [view]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [projectEditor, setProjectEditor] = useState<Project | null | undefined>();
  const [projectLayouts, setProjectLayouts] = useState<Record<string, "list" | "board">>({});
  const layout = projectId ? projectLayouts[projectId] ?? "list" : "list";
  const [navigationReady, setNavigationReady] = useState(false);
  const lastTaskNavigation = useRef({ view: "today" as View, projectId: null as string | null, filterId: null as string | null, projectLayouts: {} as Record<string, "list" | "board"> });
  const [stickyFilter, setStickyFilter] = useState<"today" | "starred" | "all">(() => {
    const saved = localStorage.getItem("dock.sticky-filter");
    return saved === "today" || saved === "starred" ? saved : "all";
  });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [newTaskOptions, setNewTaskOptions] = useState<Partial<TaskProperties>>({});
  const [newScheduledAt, setNewScheduledAt] = useState<string | undefined>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { setTaskLimit(100); }, [view, projectId, filterId, query]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null | undefined>(undefined);
  /** Another task waiting to open while the side panel has unsaved changes. */
  const [switchTo, setSwitchTo] = useState<{ next: Item | null } | null>(null);
  const editorDirty = useRef(false);
  const [feedback, setFeedback] = useState<{ token: string; action: "delete" | "complete"; count: number; title?: string } | null>(null);
  const [edited, setEdited] = useState<{ message: string; title: string; revert: () => Promise<unknown> } | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [undoing, setUndoing] = useState(false);
  const [completions, setCompletions] = useState<Record<string, { item: Item; phase: "saving" | "complete" }>>({});
  const displayItems = useMemo(() => (snapshot?.items ?? []).map(item => completions[item.id]?.item ?? item), [snapshot?.items, completions]);
  const projectTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (role !== "main") return counts;
    for (const item of snapshot?.items ?? []) {
      if (item.kind === "task" && !item.done && item.task.projectId)
        counts.set(item.task.projectId, (counts.get(item.task.projectId) ?? 0) + 1);
    }
    return counts;
  }, [snapshot?.items]);
  const openProject = useCallback((id: string) => { setProjectId(id); setQuery(''); setView('project'); }, []);
  const itemIndex = useMemo(() => {
    const byId = new Map(displayItems.map(item => [item.id, item]));
    const children = new Map<string, Item[]>();
    for (const item of displayItems) {
      if (!item.task.parentId) continue;
      const siblings = children.get(item.task.parentId) ?? [];
      siblings.push(item); children.set(item.task.parentId, siblings);
    }
    return { byId, children };
  }, [displayItems]);
  const completionTimers = useRef(new Map<string, number>());
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const today = localDate(new Date(clock));
  const formatting = role === "main" || role === "mini"
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions() : null;
  const timeZone = formatting?.timeZone ?? "";
  const locale = formatting ? JSON.stringify([formatting.locale, formatting.calendar, formatting.numberingSystem, formatting.hourCycle]) : "";
  const navigationCounts = useMemo<Partial<Record<View, number>>>(() => {
    if (role !== "main") return {};
    const counts = { today: 0, inbox: 0, all: 0, starred: 0, done: 0 };
    for (const item of snapshot?.items ?? []) {
      if (item.kind !== "task") continue;
      if (item.done) { counts.done++; continue; }
      counts.all++;
      if (dueBy(item, today)) counts.today++;
      if (!item.task.projectId) counts.inbox++;
      if (item.task.priority < 4) counts.starred++;
    }
    return counts;
  }, [snapshot?.items, today, timeZone]);
  const collation = role === "main" ? new Intl.Collator().resolvedOptions().locale : "";
  const projectNavigation = useMemo(() => {
    if (role !== "main" || !snapshot) return null;
    const children = new Map<string | null, Project[]>();
    for (const project of snapshot.workspace.projects) {
      const siblings = children.get(project.parentId) ?? [];
      siblings.push(project); children.set(project.parentId, siblings);
    }
    const tree = (parentId: string | null, depth = 0): React.ReactNode => (children.get(parentId) ?? []).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name)).map(project => <div key={project.id}>
      <ActionButton aria-label={`Project ${project.name}`} size="nav" className={`nav-button ${view === 'project' && projectId === project.id ? 'active' : ''}`} style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }} onClick={() => openProject(project.id)}><Hash size="1rem" style={{ color: project.color }} /><span className="nav-label">{project.name}</span>{project.favorite && <Star size="0.6875rem" />}<small>{projectTaskCounts.get(project.id) || ''}</small></ActionButton>
      {tree(project.id, depth + 1)}
    </div>);
    return tree(null);
  }, [snapshot?.workspace.projects, projectTaskCounts, view, projectId, openProject, collation]);
  const search = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const floatingDrag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const floatingDragged = useRef(false);
  useEffect(() => window.dock.onNavigate(destination => {
    if (role !== "main") return;
    setQuery(""); setSearchOpen(false); setView(destination);
    if (destination === "settings") main.current?.scrollTo({ top: 0 });
  }), []);
  useEffect(() => window.dock.onOpenTask(id => {
    const item = latest.current?.items.find(item => item.id === id);
    if (role === "main" && item) openEditor(item);
  }), []);
  useEffect(() => {
    if (role === "mini") localStorage.setItem("dock.sticky-filter", stickyFilter);
  }, [stickyFilter]);
  useEffect(() => {
    if (!snapshot || role !== "main" || navigationReady) return;
    if (snapshot.settings.rememberLastView) {
      try {
        const saved = JSON.parse(localStorage.getItem("dock.main-navigation") ?? "null");
        const views: View[] = ["today", "inbox", "all", "starred", "notes", "schedule", "done", "project", "filters", "filter", "progress", "trash"];
        if (saved && views.includes(saved.view) &&
            (saved.view !== "project" || snapshot.workspace.projects.some(project => project.id === saved.projectId)) &&
            (saved.view !== "filter" || snapshot.workspace.filters.some(filter => filter.id === saved.filterId))) {
          setView(saved.view);
          setProjectId(typeof saved.projectId === "string" ? saved.projectId : null);
          setFilterId(typeof saved.filterId === "string" ? saved.filterId : null);
          if (saved.projectLayouts && typeof saved.projectLayouts === "object") {
            setProjectLayouts(Object.fromEntries(snapshot.workspace.projects.filter(project => ["list", "board"].includes(saved.projectLayouts[project.id])).map(project => [project.id, saved.projectLayouts[project.id]])));
          }
        }
      } catch { localStorage.removeItem("dock.main-navigation"); }
    }
    setNavigationReady(true);
  }, [snapshot, navigationReady]);
  useEffect(() => {
    if (role !== "main" || !navigationReady || !snapshot) return;
    if (view !== "settings") lastTaskNavigation.current = { view, projectId, filterId, projectLayouts };
    if (!snapshot.settings.rememberLastView) localStorage.removeItem("dock.main-navigation");
    else localStorage.setItem("dock.main-navigation", JSON.stringify(lastTaskNavigation.current));
  }, [navigationReady, snapshot?.settings.rememberLastView, view, projectId, filterId, projectLayouts]);
  useEffect(() => {
    if (feedback && snapshot?.undo?.token !== feedback.token) setFeedback(null);
  }, [snapshot?.undo?.token, feedback]);
  useEffect(() => window.dock.onBeforeUpdate(async () => {
    if (editing !== undefined || projectEditor !== undefined || templatesOpen || captureTitle.trim())
      throw new Error("Finish or close your task draft before restarting Rivnote.");
  }), [editing, projectEditor, templatesOpen, captureTitle]);
  useEffect(() => () => {
    completionTimers.current.forEach(timer => window.clearTimeout(timer));
  }, []);
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
    setSelected([]); setBulkMode(false); setNewTaskOptions({});
  }, [view, projectId, filterId]);
  useEffect(() => {
    document.documentElement.dataset.theme = snapshot?.settings.theme ?? "dark";
    document.documentElement.dataset.uiPreset = snapshot?.settings.uiPreset ?? "ink";
    document.documentElement.dataset.density = snapshot?.settings.density ?? "compact";
    document.documentElement.dataset.window = role;
    document.documentElement.dataset.noteFont = snapshot?.settings.noteFont ?? "system";
    document.documentElement.style.setProperty("--note-font-size", `${(snapshot?.settings.noteSize ?? 16) / 16}rem`);
    if (snapshot) {
      for (const [property, value] of Object.entries(themeStyle(snapshot.settings))) {
        document.documentElement.style.setProperty(property, String(value));
      }
    }
  }, [snapshot?.settings.theme, snapshot?.settings.themeColors, snapshot?.settings.uiPreset, snapshot?.settings.colorPreset, snapshot?.settings.rounding, snapshot?.settings.density, snapshot?.settings.noteFont, snapshot?.settings.noteSize]);
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
        role === "main"
      ) {
        event.preventDefault();
        setCommandsOpen(true);
      }
      if (event.key === "Escape" && editing === undefined) {
        if (role === "capture") act({ type: "window", action: "hide" });
        else if (role === "mini" || role === "floating") act({ type: "window", action: "floating" });
        else {
          setSearchOpen(false);
          setQuery("");
        }
      }
      if (event.key === "Escape" || role !== "main" && role !== "mini" || editableTarget(event.target) || event.altKey) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey && (edited || feedback)) {
        event.preventDefault();
        void (edited ? revertEdit() : undoFeedback());
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      const taskButtons = [...document.querySelectorAll<HTMLButtonElement>(".task-row .task-open")];
      const current = taskButtons.findIndex(button => button.contains(document.activeElement));
      if (["j", "k", "arrowdown", "arrowup"].includes(key) && (current >= 0 || document.activeElement === document.body)) {
        event.preventDefault();
        taskButtons[Math.max(0, Math.min(taskButtons.length - 1, current + (key === "j" || key === "arrowdown" ? 1 : current < 0 ? taskButtons.length : -1)))]?.focus();
      } else if (key === "e" && current >= 0) {
        const item = latest.current?.items.find(item => item.id === taskButtons[current]!.closest<HTMLElement>(".task-row")?.dataset.taskId);
        if (item) { event.preventDefault(); void toggleTask(item); }
      } else if (key === "q" && role === "main") {
        event.preventDefault();
        beginTask();
      } else if (key === "/" && role === "main") {
        event.preventDefault();
        setSearchOpen(true);
        if (view === "schedule" || view === "settings") setView("all");
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  });

  const remove = useCallback(async (item: Item) => {
    try {
      const result = await dispatch({ type: "item.delete", id: item.id });
      setEditing(undefined);
      if (result.undo) { setEdited(null); setFeedback({ ...result.undo, title: item.title }); }
    } catch {
      /* The shared error banner reports the failure. */
    }
  }, [dispatch]);
  const clearCompletion = useCallback((id: string) => {
    window.clearTimeout(completionTimers.current.get(id));
    completionTimers.current.delete(id);
    setCompletions(current => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);
  const toggleTask = useCallback(async (item: Item) => {
    if (completions[item.id]) return;
    setCompletions(current => ({ ...current, [item.id]: { item, phase: "saving" } }));
    try {
      const result = await dispatch({ type: item.done ? "item.toggle" : "item.complete", id: item.id });
      if (item.done) {
        clearCompletion(item.id);
        setFeedback(null);
      } else {
        setCompletions(current => ({ ...current, [item.id]: { item, phase: "complete" } }));
        if (result.undo) { setEdited(null); setFeedback({ ...result.undo, title: item.title }); }
        completionTimers.current.set(item.id, window.setTimeout(() => clearCompletion(item.id), 900));
      }
    } catch {
      clearCompletion(item.id);
    }
  }, [completions, dispatch, clearCompletion]);
  const quickEdit = useCallback(async (item: Item, changes: Partial<Item>, message: string) => {
    try {
      const result = await dispatch({ type: "item.save", item: { ...item, ...changes, expectedRevision: item.revision } });
      const revision = result.items.find(saved => saved.id === item.id)?.revision;
      setFeedback(null);
      setEdited({ message, title: item.title, revert: () => dispatch({ type: "item.save", item: { ...item, expectedRevision: revision } }) });
    } catch {
      /* The shared error banner reports the failure. */
    }
  }, [dispatch]);
  async function revertEdit() {
    if (!edited || undoing) return;
    setUndoing(true);
    try { await edited.revert(); setEdited(null); }
    catch { /* The shared error banner reports the failure. */ }
    finally { setUndoing(false); }
  }
  async function undoFeedback() {
    if (!feedback || undoing) return;
    setUndoing(true);
    try {
      await dispatch({ type: "item.undo", token: feedback.token });
      completionTimers.current.forEach(timer => window.clearTimeout(timer));
      completionTimers.current.clear();
      setCompletions({});
      setFeedback(current => current === feedback ? null : current);
    } catch {
      /* The shared error banner reports the failure; Undo remains available. */
    } finally {
      setUndoing(false);
    }
  }
  const openEditor = useCallback((next: Item | null) => {
    if (editing !== undefined && editorDirty.current && next?.id !== editing?.id) setSwitchTo({ next });
    else setEditing(next);
  }, [editing]);
  if (!snapshot)
    return role === "floating" ? null : (
      <div className="startup">
        <img className="brand-mark brand-mark-large" src={brandMark} alt="" />
        <h1>Rivnote</h1>
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
  if (role === "floating") {
    const count = snapshot.items.filter(item => item.kind === "task" && !item.done).length;
    const style = snapshot.settings.floating;
    function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
      floatingDragged.current = false;
      if (event.button !== 0) return;
      floatingDrag.current = { x: event.screenX - window.screenX, y: event.screenY - window.screenY, startX: event.screenX, startY: event.screenY };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
      const drag = floatingDrag.current;
      if (!drag) return;
      if (Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) > 4) floatingDragged.current = true;
      if (floatingDragged.current && !style.locked) window.dock.moveFloating(event.screenX - drag.x, event.screenY - drag.y);
    }
    function moveKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
      const offsets: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
      const offset = offsets[event.key];
      if (!offset || style.locked) return;
      event.preventDefault();
      window.dock.moveFloating(window.screenX + offset[0], window.screenY + offset[1]);
    }
    const moveHandlers = { onPointerDown: pointerDown, onPointerMove: pointerMove,
      onLostPointerCapture: () => { floatingDrag.current = null; }, onPointerCancel: () => { floatingDragged.current = false; }, onKeyDown: moveKey };
    return <div className="floating-launcher" style={floatingStyle(style)}>
      {style.showHandle && <Button className="floating-handle" aria-label="Move floating icon" disabled={style.locked}
        title="Drag to move · Arrow keys when focused" {...moveHandlers}><GripHorizontal size={18} /></Button>}
      <Button autoFocus className="floating-button" aria-label={`${snapshot.system.miniOpen ? 'Hide' : 'Show'} tasks (${count} active)`}
        aria-expanded={snapshot.system.miniOpen} {...moveHandlers}
        title={style.locked ? "Click to toggle tasks · Position locked · Right-click to customize" : "Click to toggle tasks · Drag to move · Right-click to customize"}
        onClick={() => {
          if (floatingDragged.current) { floatingDragged.current = false; return; }
          act({ type: "window", action: snapshot.system.miniOpen ? "floating" : "mini" });
        }}>
        <ListFilter size={30} />
        {style.showCount && <span className="floating-count" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
      </Button>
    </div>;
  }
  const project = snapshot.workspace.projects.find(project => project.id === projectId);
  const compare = taskComparator(today);
  const savedFilter = snapshot.workspace.filters.find(filter => filter.id === filterId);
  let filterPredicate = (_item: Item) => true, filterFailure = '';
  if (view === 'filter' && savedFilter) {
    try { filterPredicate = compileFilter(savedFilter.query, snapshot.workspace, new Date(clock)); }
    catch (error) { filterFailure = error instanceof Error ? error.message : 'Invalid filter.'; filterPredicate = () => false; }
  }
  const searchPredicate = query ? compileSearch(query, snapshot.workspace) : null;
  const tasks = displayItems.filter(item => item.kind === "task" && (!searchPredicate || searchPredicate(item)));
  const stickyTasks = (role === "mini" ? tasks : []).filter(item => !item.done &&
    (stickyFilter === "today" ? dueBy(item, today) :
      stickyFilter === "starred" ? item.task.priority < 4 : true)).sort(compare);
  const visible = tasks
    .filter((item) => {
      if (view === "done") return item.done;
      if (view === "filter") return filterPredicate(item);
      if (item.done) return false;
      if (query) return true;
      if (view === "today") return dueBy(item, today);
      if (view === "inbox") return !item.task.projectId;
      if (view === "starred") return item.task.priority < 4;
      if (view === "project") return item.task.projectId === projectId && !item.task.parentId;
      return true;
    })
    .sort(
      (a, b) => view === "done"
        ? (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)
        : view === "project" ? a.task.order - b.task.order || compare(a, b)
        : compare(a, b),
    );
  const overdue = visible.filter(
    (item) =>
      item.scheduledAt &&
      localDate(new Date(item.scheduledAt)) < today &&
      !item.done,
  );
  const overdueIds = new Set(overdue.map(item => item.id));
  const remaining = visible.filter(item => !overdueIds.has(item.id));
  const defaults = {
    space: "Inbox" as const,
    scheduledAt: view === "today" ? todaySchedule() : null,
    priority: view === "starred",
    task: { projectId: view === "project" ? projectId : null, ...newTaskOptions },
  };
  async function captureTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!captureTitle.trim()) return;
    setCapturing(true); setCaptureError("");
    try {
      const parsed = parseTaskText(captureTitle, snapshot!.workspace, new Date(), ignored);
      await dispatch({ type: "item.save", item: {
        kind: "task", title: parsed.title, body: "", ...defaults, task: taskPropertiesSchema.parse({ ...defaults.task, ...parsed.task }), tags: parsed.tags,
        scheduledAt: parsed.scheduledAt ?? defaults.scheduledAt,
        recurrence: parsed.recurrence, linkedNoteId: null,
      } });
      setCaptureTitle(""); setIgnored([]);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'Could not add the task.');
    } finally { setCapturing(false); }
  }
  const title =
    view === "settings"
      ? "Preferences"
      : view === "project" ? project?.name ?? 'Project'
      : view === "filter" ? savedFilter?.name ?? 'Saved filter'
      : view === "trash" ? 'Recently deleted'
      : navigation.find((item) => item.id === view)?.title ?? 'Rivnote';
  function navigate(destination: View) {
    setQuery(""); setSearchOpen(false); setView(destination);
  }
  function setLayout(next: "list" | "board") {
    if (projectId) setProjectLayouts(current => ({ ...current, [projectId]: next }));
  }
  function openFilter(id: string) { setFilterId(id); setQuery(''); setView('filter'); }
  function beginTask(sectionId: string | null = null, scheduledAt?: string) { setNewTaskOptions({ sectionId }); setNewScheduledAt(scheduledAt); openEditor(null); }
  async function bulk(action: 'complete' | 'delete' | 'update', patch?: { task?: Partial<TaskProperties>; scheduledAt?: string | null; space?: Item['space'] }) {
    setBulkBusy(true);
    try {
      const result = await dispatch({ type: 'item.bulk', ids: selected, action, patch, expectedRevisions: Object.fromEntries(snapshot!.items.filter(item => selected.includes(item.id)).map(item => [item.id, item.revision])) });
      if (action !== 'update' && result.undo) setFeedback(result.undo);
      setSelected([]);
    }
    catch { /* The shared error banner reports the failure. */ }
    finally { setBulkBusy(false); }
  }
  /** `tree` lists open subtasks under their parents; `nested` marks those subtask rows. */
  const rows = (items: Item[], tree = false, nested = false): React.ReactNode =>
    items.map((item) => <Fragment key={item.id}>
      <TaskRow
        item={item}
        snapshot={snapshot}
        note={itemIndex.byId.get(item.linkedNoteId ?? "")}
        parent={nested ? undefined : itemIndex.byId.get(item.task.parentId ?? "")}
        children={itemIndex.children.get(item.id) ?? noChildren}
        clock={clock}
        locale={locale}
        timeZone={timeZone}
        onChange={quickEdit}
        nested={nested}
        onOpen={openEditor}
        onDelete={remove}
        onToggle={toggleTask}
        completion={completions[item.id]?.phase}
        selected={bulkMode ? selected.includes(item.id) : undefined}
        onSelect={bulkMode ? () => setSelected(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id]) : undefined}
      />
      {tree && rows((itemIndex.children.get(item.id) ?? []).filter(child => !child.done)
        .sort((a, b) => a.task.order - b.task.order || compare(a, b)), true, true)}
    </Fragment>);

  const editor = editing !== undefined && (
    <TaskEditor
      key={editing?.id ?? "new"}
      item={editing}
      panel={role === "main"}
      defaults={{ ...defaults, scheduledAt: newScheduledAt ?? defaults.scheduledAt }}
      onOpen={setEditing}
      snapshot={snapshot}
      dispatch={dispatch}
      onDirty={dirty => { editorDirty.current = dirty; }}
      switching={!!switchTo}
      onKeep={() => setSwitchTo(null)}
      onClose={() => { editorDirty.current = false; setEditing(switchTo ? switchTo.next : undefined); setSwitchTo(null); }}
      onDelete={(item) => void remove(item)}
    />
  );
  return (
    <div
      className={`app-shell parity ${role} ${snapshot.system.platform === "darwin" ? "mac" : ""}`}
      inert={snapshot.update.status === "installing"}
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
            <X size="0.9375rem" />
          </ActionButton>
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
                  {snapshot.system.platform === "darwin" && "All desktops · "}
                  {snapshot.system.topmostSupported
                    ? snapshot.settings.miniPinned ? "Always on top" : "Unpinned"
                    : "Always-on-top unavailable on Wayland"}
                </p>
              </div>
              <div className="heading-tools">
              <UpdateNotice update={snapshot.update} version={snapshot.system.version} act={act} />
              <ActionButton aria-label="Collapse to floating icon" onClick={() => act({ type: "window", action: "floating" })}>
                <Minimize2 size="1rem" />
              </ActionButton>
              <ActionButton
                aria-label="Open main app"
                onClick={() => act({ type: "window", action: "main" })}
              >
                <Maximize2 size="1rem" />
              </ActionButton>
              </div>
            </div>
            <div className="sticky-toolbar">
              <Select value={stickyFilter} onValueChange={value => setStickyFilter(value as "today" | "starred" | "all")}>
                <SelectTrigger size="xs" aria-label="Sticky task filter"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All tasks</SelectItem><SelectItem value="today">Today</SelectItem><SelectItem value="starred">Priority</SelectItem></SelectContent>
              </Select>
              <Button size="xs" variant="ghost" onClick={() => act({ type: "window", action: "main", view: stickyFilter })}>View all ({stickyTasks.length})</Button>
            </div>
            {stickyTasks.length ? (
              rows(stickyTasks.slice(0, 6))
            ) : (
              <Empty title="Nothing to lose track of">
                {stickyFilter === "all" ? "Capture something to keep it nearby." : "Choose All tasks to see other work."}
              </Empty>
            )}
          </div>
          <Button variant="ghost"
            className="inline-add mini-add"
            onClick={() => act({ type: "window", action: "capture" })}
          >
            <Plus size="1.0625rem" /> Quick capture
          </Button>
        </>
      ) : (
        <>
          <div className={`workspace ${editing !== undefined ? "with-panel" : ""}`}>
          <aside className="sidebar">
            <div className="sidebar-sections">
            <div className="sidebar-label">Workspace</div>
            <nav className="navigation" aria-label="App navigation">
              {navigation.map(({ id, title, icon: Icon }) => {
                const count = navigationCounts[id] ?? 0;
                return (
                  <ActionButton aria-label={title} size="nav" key={id} className={`nav-button ${view === id ? "active" : ""}`}
                    aria-current={view === id ? "page" : undefined}
                    onClick={() => navigate(id)}>
                    <Icon size="1rem" /><span className="nav-label">{title}</span>
                    {!["notes", "schedule", "filters", "progress"].includes(id) && count > 0 && <Badge variant="secondary" className="nav-count">{count}</Badge>}
                  </ActionButton>
                );
              })}
            </nav>
            <Separator className="my-2" />
            <div className="sidebar-project-heading"><div className="sidebar-label">Projects</div><ActionButton aria-label="New project" size="icon-xs" onClick={() => setProjectEditor(null)}><Plus size="0.875rem" /></ActionButton></div>
            <nav className="project-navigation" aria-label="Projects">{projectNavigation}</nav>
            {snapshot.workspace.filters.some(filter => filter.favorite) && <><div className="sidebar-label">Favorite filters</div><nav aria-label="Favorite filters">{snapshot.workspace.filters.filter(filter => filter.favorite).map(filter => <ActionButton key={filter.id} aria-label={`Filter ${filter.name}`} size="nav" className={`nav-button ${view === 'filter' && filterId === filter.id ? 'active' : ''}`} onClick={() => openFilter(filter.id)}><Filter size="0.9375rem" /><span className="nav-label">{filter.name}</span></ActionButton>)}</nav></>}
            </div>
            <div className="sidebar-bottom">
              <ActionButton aria-label="Recently deleted" size="nav" className={`nav-button ${view === 'trash' ? 'active' : ''}`} onClick={() => navigate("trash")}><Trash2 size="1rem" /><span className="nav-label">Recently deleted</span></ActionButton>
              <ActionButton aria-label="Quick capture" size="nav" className="nav-button" onClick={() => act({ type: "window", action: "capture" })}>
                <Zap size="1rem" /><span className="nav-label">Quick capture</span>
              </ActionButton>
              <ActionButton aria-label="Preferences" size="nav" className={`nav-button ${view === "settings" ? "active" : ""}`}
                aria-current={view === "settings" ? "page" : undefined}
                onClick={() => navigate("settings")}>
                <Settings2 size="1rem" /><span className="nav-label">Preferences</span>
              </ActionButton>
            </div>
          </aside>
          <main ref={main} className={`main ${view === "notes" ? "main-notes" : ""}`}>
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
              {!["settings", "notes", "schedule", "done", "filters", "progress", "trash"].includes(view) && (
                <div className="heading-tools">
                  <Button variant="default"

                    aria-label="New task"
                    onClick={() => beginTask()}
                  >
                    <Plus size="1rem" /> New task
                  </Button>
                </div>
              )}
            </div>}
            {view === 'project' && project && <div className="project-toolbar"><div className="view-switch"><Button size="xs" variant={layout === 'list' ? 'secondary' : 'ghost'} onClick={() => setLayout('list')}><List size="0.8125rem" />List</Button><Button size="xs" variant={layout === 'board' ? 'secondary' : 'ghost'} onClick={() => setLayout('board')}><LayoutGrid size="0.8125rem" />Board</Button></div><Button size="xs" variant="ghost" disabled={snapshot.syncFeatures.projects.some(shared => shared.id === project.id && shared.ownerEmail !== snapshot.sync.email)} onClick={() => setProjectEditor(project)}><Pencil size="0.8125rem" />Edit project</Button><Button size="xs" variant="ghost" onClick={() => setTemplatesOpen(true)}><Copy size="0.8125rem" />Templates</Button><SharedProjectSettings project={project} snapshot={snapshot} dispatch={dispatch} /></div>}
            {view === 'filter' && savedFilter && <p className="filter-description">{savedFilter.query}</p>}
            {filterFailure && <p role="alert" className="note-error">{filterFailure}</p>}
            {searchOpen && view !== "settings" && (
              <div className="search">
                <Search size="1.0625rem" />
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
                  <X size="0.9375rem" />
                </ActionButton>
              </div>
            )}
            <div className="notes-view" hidden={view !== "notes"}>
              {(view === "notes" || notesMounted) && <Suspense fallback={<p role="status">Opening notes…</p>}><Notes
                active={view === "notes"}
                snapshot={snapshot}
                query={view === "notes" ? query : ""}
                dispatch={dispatch}
                onTask={openEditor}
                onDelete={(item) => void remove(item)}
                openNoteId={openNoteId}
                onNoteOpened={() => setOpenNoteId(null)}
              /></Suspense>}
            </div>
            {view === "schedule" ? (
              <Schedule items={displayItems} renderTasks={rows} snapshot={snapshot} dispatch={dispatch} onOpen={openEditor} onAdd={scheduledAt => beginTask(null, scheduledAt)} />
            ) : view === 'filters' ? (
              <Filters snapshot={snapshot} dispatch={dispatch} renderTasks={rows} onFilter={openFilter} />
            ) : view === 'progress' ? (
              <Progress snapshot={snapshot} dispatch={dispatch} renderTasks={rows} />
            ) : view === 'trash' ? (
              <RecentlyDeleted snapshot={snapshot} dispatch={dispatch} />
            ) : view === "settings" ? (
              <Settings snapshot={snapshot} dispatch={dispatch} act={act} onReviewConflicts={() => setConflictsOpen(true)} />
            ) : (
              view !== "notes" && (
                <>
                  {view !== "done" && !query && (
                    <form className="quick-add" onSubmit={event => void captureTask(event)}>
                      <Plus size="1rem" />
                      <Input size="xs" aria-label="Quick add task" placeholder="Add a task… try next Tue 9am p2 @work"
                        value={captureTitle} onChange={event => setCaptureTitle(event.target.value)} required maxLength={500} disabled={capturing} />
                      <Button size="xs" variant="outline" type="submit" disabled={capturing || !captureTitle.trim()}>{capturing ? "Saving…" : "Add"}</Button>
                    </form>
                  )}
                  {captureError && <p role="alert" className="note-error">{captureError}</p>}
                  {captureTitle && (() => { try { return <RecognizedTokens tokens={parseTaskText(captureTitle, snapshot.workspace, new Date(), ignored).recognized} onKeep={token => setIgnored(current => [...current, token.toLowerCase()])} />; } catch { return null; } })()}
                  {!(view === 'project' && layout === 'board') && <div className="list-toolbar"><span className="muted">{visible.length} {visible.length === 1 ? 'task' : 'tasks'}</span><Button variant="ghost" size="xs" onClick={() => { setBulkMode(!bulkMode); setSelected([]); }}>{bulkMode ? 'Done selecting' : 'Select tasks'}</Button>{bulkMode && <Button size="xs" variant="ghost" onClick={() => setSelected(visible.map(item => item.id))}>Select all</Button>}{view !== 'project' && <Button variant="ghost" size="xs" onClick={() => setTemplatesOpen(true)}>Templates</Button>}</div>}
                  {!!selected.length && <div className="bulk-actions" aria-label="Bulk actions"><strong>{selected.length} selected</strong><Button size="xs" variant="outline" disabled={bulkBusy} onClick={() => void bulk('complete')}>Complete</Button><Select value="priority" onValueChange={value => void bulk('update', { task: { priority: Number(value) as TaskProperties['priority'] } })}><SelectTrigger size="xs" aria-label="Bulk priority" disabled={bulkBusy}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="priority" disabled>Priority</SelectItem>{[1,2,3,4].map(priority => <SelectItem key={priority} value={String(priority)}>P{priority}</SelectItem>)}</SelectContent></Select><Select value="project" onValueChange={value => void bulk('update', { task: { projectId: value === 'none' ? null : value, sectionId: null } })}><SelectTrigger size="xs" aria-label="Bulk project" disabled={bulkBusy}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="project" disabled>Move to project</SelectItem><SelectItem value="none">No project</SelectItem>{snapshot.workspace.projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select><Button size="xs" variant="outline" disabled={bulkBusy} onClick={() => void bulk('update', { scheduledAt: todaySchedule() })}>Today</Button><Button size="xs" variant="ghost" className="danger" disabled={bulkBusy} onClick={() => void bulk('delete')}>Delete</Button></div>}
                  {view === 'project' && project && layout === 'board' ? <ProjectBoard project={project} items={visible} snapshot={snapshot} dispatch={dispatch} onOpen={openEditor} onAdd={beginTask} onToggle={item => void toggleTask(item)} /> : view === 'project' && project ? <div className="project-list">{[{ id: null, name: 'No section' }, ...project.sections].map(section => <section key={section.id ?? 'none'}><div className="group-label"><span>{section.name}</span><span>{visible.filter(item => item.task.sectionId === section.id).length}</span><ActionButton aria-label={`Add task in ${section.name}`} size="icon-xs" onClick={() => beginTask(section.id)}><Plus size="0.875rem" /></ActionButton></div>{rows(visible.slice(0, taskLimit).filter(item => item.task.sectionId === section.id), true)}</section>)}</div> : <>
                  {!!overdue.length && (
                    <>
                      <div className="group-label overdue">
                        <span>Overdue</span>
                        <span>{overdue.length}</span>
                      </div>
                      {rows(overdue.slice(0, taskLimit))}
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
                      {rows(remaining.slice(0, Math.max(0, taskLimit - overdue.length)))}
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
                        ? "Try another search."
                        : view === "today"
                          ? "Schedule a task for today, or capture something for later."
                          : "Use quick capture to add a task or note."}
                    </Empty>
                  )}
                  </>}
                  {!(view === 'project' && layout === 'board') && visible.length > taskLimit &&
                    <Button variant="outline" onClick={() => setTaskLimit(current => current + 100)}>Show more tasks · {taskLimit} of {visible.length}</Button>}
                </>
              )
            )}
          </main>
          {editor}
          </div>
          <footer className="foot">
            <span>
              <span className="status-dot" /> Saved on this{" "}
              {snapshot.system.platform === "darwin" ? "Mac" : "computer"} · Works
              offline
              {!snapshot.sync.connected && <Button variant="ghost" className="sync-status" onClick={() => navigate("settings")}>
                · {snapshot.sync.endpoint ? "Sign in to sync" : "Create account"}
              </Button>}
              {(snapshot.sync.connected || snapshot.sync.conflicts > 0) && (
                <Button variant="ghost" className="sync-status" onClick={() => snapshot.sync.conflicts ? setConflictsOpen(true) : navigate("settings")}>
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
        <div key={feedback.token}
          className={`undo-toast ${feedback.action === "complete" ? "completion-toast" : ""}`} role="status">
          {feedback.action === "complete" && <Check className="completion-check" size="1.125rem" aria-hidden="true" />}
          <span className="completion-message"><strong>{feedback.count === 1 ? (feedback.action === "complete" ? "Task completed" : "Item deleted") : `${feedback.count} items ${feedback.action === "complete" ? "completed" : "deleted"}`}</strong>{feedback.title && <span>{feedback.title}</span>}</span>
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
            <X size="0.875rem" />
          </ActionButton>
        </div>
      )}
      {edited && !feedback && (
        <div className="undo-toast completion-toast" role="status">
          <span className="completion-message"><strong>{edited.message}</strong><span>{edited.title}</span></span>
          <Button variant="ghost" disabled={undoing} onClick={() => void revertEdit()}>Undo</Button>
          <ActionButton aria-label="Dismiss undo" onClick={() => setEdited(null)}><X size="0.875rem" /></ActionButton>
        </div>
      )}
      {projectEditor !== undefined && <ProjectEditor project={projectEditor} snapshot={snapshot} dispatch={dispatch} onClose={() => setProjectEditor(undefined)} onSaved={openProject} />}
      {templatesOpen && <Templates snapshot={snapshot} dispatch={dispatch} projectId={view === 'project' ? projectId : null} onClose={() => setTemplatesOpen(false)} />}
      {commandsOpen && <CommandMenu snapshot={snapshot} onClose={() => setCommandsOpen(false)} onTask={openEditor} onProject={openProject} actions={[
        { title: 'New task', run: () => beginTask() }, { title: 'New project', run: () => setProjectEditor(null) },
        { title: 'Task templates', run: () => setTemplatesOpen(true) },
        { title: 'Quick capture', run: () => act({ type: 'window', action: 'capture' }) },
        ...navigation.map(item => ({ title: `Go to ${item.title}`, run: () => navigate(item.id) })),
        { title: 'Preferences', run: () => navigate('settings') }, { title: 'Recently deleted', run: () => navigate('trash') },
      ]} />}
      {conflictsOpen && <SyncConflicts snapshot={snapshot} dispatch={dispatch}
        onClose={() => { setConflictsOpen(false); clearError(); }}
        beforeResolve={async () => {
          if (editorDirty.current) throw new Error("Save or close your task changes before resolving a conflict.");
          await window.dock.prepareUpdate(true);
        }}
        onOpenItem={item => {
          setConflictsOpen(false);
          if (item.kind === "task") openEditor(item);
          else { setOpenNoteId(item.id); navigate("notes"); }
        }} />}
      {role !== "main" && editor}
    </div>
  );
}
