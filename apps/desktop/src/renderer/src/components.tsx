import { memo, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { TimePicker } from "@/components/ui/time-picker";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { CalendarPlus, CalendarDays, CalendarOff, ChevronLeft, CornerDownRight, FileText, FolderInput, Link2, MoreHorizontal, Pencil, Repeat2, Trash2, Flag, MessageSquare, GitBranch, X } from "lucide-react";
import { localDate, type Item, type Snapshot } from "@dock/contracts";
import { recurrenceLabel } from "./lib/tasks";

export function todaySchedule(): string {
  const date = new Date();
  date.setHours(23, 59, 0, 0);
  return date.toISOString();
}

export function ActionButton({ className, ...props }: ButtonProps & { "aria-label": string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" className={cn("icon-button", className)} {...props} />
      </TooltipTrigger>
      <TooltipContent>{props["aria-label"]}</TooltipContent>
    </Tooltip>
  );
}

let labelFormatters: { date: Intl.DateTimeFormat; time: Intl.DateTimeFormat } | undefined;
function taskDateFormatters() {
  if (!labelFormatters) {
    labelFormatters = {
      date: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
      time: new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }),
    };
    // Release at the next microtask so later locale and timezone changes stay fresh.
    queueMicrotask(() => { labelFormatters = undefined; });
  }
  return labelFormatters;
}

export function dueLabel(item: Item): string {
  if (!item.scheduledAt) return "No date";
  const date = new Date(item.scheduledAt);
  const today = localDate();
  const day = localDate(date);
  const label =
    day === today
      ? "Today"
      : taskDateFormatters().date.format(date);
  return `${day < today && !item.done ? "Overdue · " : ""}${label} · ${taskDateFormatters().time.format(date)}`;
}

export const TaskRow = memo(function TaskRow({
  item,
  snapshot,
  note,
  parent,
  children,
  onChange,
  onOpen,
  onToggle,
  onDelete,
  completion,
  selected,
  onSelect,
  nested,
}: {
  item: Item;
  snapshot: Snapshot;
  note?: Item;
  parent?: Item;
  children: readonly Item[];
  /** Ambient date context invalidates rows even when task data is unchanged. */
  clock: number;
  locale: string;
  timeZone: string;
  /** Saves a quick edit; the message describes it in the Undo notice. */
  onChange: (item: Item, changes: Partial<Item>, message: string) => void;
  onOpen: (item: Item) => void;
  onToggle: (item: Item) => void;
  onDelete: (item: Item) => void;
  completion?: "saving" | "complete";
  selected?: boolean;
  onSelect?: () => void;
  /** Shown under its parent, so the parent title is omitted. */
  nested?: boolean;
}) {
  const done = completion ? !item.done : item.done;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionView, setActionView] = useState<"actions" | "date" | "project">("actions");
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  const [scheduled, setScheduled] = useState(() => new Date(item.scheduledAt ?? todaySchedule()));
  const [priorityOpen, setPriorityOpen] = useState(false);
  const shared = snapshot.syncFeatures.projects.some(project => project.id === item.task.projectId);
  function schedule(value: string | null) {
    onChange(item, { scheduledAt: value, recurrence: value ? item.recurrence : "none" },
      value ? `Scheduled ${dueLabel({ ...item, scheduledAt: value })}` : item.recurrence !== "none" ? "Date and repeat removed" : "Date removed");
    setActionsOpen(false);
  }
  function moveProject(projectId: string) {
    const nextId = projectId === "none" ? null : projectId;
    if (nextId !== item.task.projectId) {
      onChange(item, { task: { ...item.task, projectId: nextId, sectionId: null, assignee: "" } },
        `Moved to ${snapshot.workspace.projects.find(project => project.id === nextId)?.name ?? "No project"}`);
    }
    setActionsOpen(false);
  }
  return (
    <div className={cn("task-row", `priority-${item.task.priority}`, done && "completed", selected && "selected", nested && "subtask", completion === "complete" && "task-completing")}
      data-task-id={item.id}
      aria-busy={completion === "saving"}
      onContextMenu={event => {
        if (completion || !event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        setPriorityOpen(false);
        setContextPoint({ x: event.clientX, y: event.clientY });
        setActionView("actions");
        setActionsOpen(true);
      }}>
      {selected !== undefined && <Checkbox aria-label={`Select ${item.title}`} checked={selected} onCheckedChange={onSelect} />}
      <Checkbox
        className="check"
        checked={done}
        disabled={!!completion}
        aria-label={`${done ? "Reopen" : "Complete"} ${item.title}`}
        onCheckedChange={() => onToggle(item)}
      />
      <Button variant="ghost" className="task-open" disabled={!!completion} onClick={() => onOpen(item)}>
        <span className="task-title">{item.title}</span>
        <span className="task-meta">
          <span>{snapshot.workspace.projects.find(project => project.id === item.task.projectId)?.name ?? "No project"}</span>
          {parent && <span className="task-parent"><CornerDownRight size="0.75rem" />{parent.title}</span>}
          {item.task.priority < 4 && <span className="priority-text"><Flag size="0.6875rem" />P{item.task.priority}</span>}
          {item.tags.map(tag => <span className="task-label" key={tag}>@{tag}</span>)}
          {children.length > 0 && <span><GitBranch size="0.75rem" />{children.filter(child => child.done).length}/{children.length}</span>}
          {item.task.comments.length > 0 && <span><MessageSquare size="0.75rem" />{item.task.comments.length}</span>}
          {item.task.deadline && <span className={localDate(new Date(item.task.deadline)) < localDate() && !item.done ? 'overdue' : ''}>Deadline {taskDateFormatters().date.format(new Date(item.task.deadline))}</span>}
          {item.task.assignee && <span>{item.task.assignee}</span>}
          {item.done && item.completedAt && <span>Completed {new Date(item.completedAt).toLocaleDateString()}</span>}
          {item.scheduledAt && (
            <span
              className={
                new Date(item.scheduledAt).getTime() < Date.now() && !item.done
                  ? "overdue"
                  : ""
              }
            >
              {dueLabel(item)}
            </span>
          )}
          {item.recurrence !== "none" && (
            <>
              <Repeat2 size="0.75rem" />
              <span>{recurrenceLabel(item)}</span>
            </>
          )}
          {note && (
            <>
              <Link2 size="0.75rem" />
              <span>{note.title}</span>
            </>
          )}
        </span>
      </Button>
      {!item.done && (!item.scheduledAt || localDate(new Date(item.scheduledAt)) !== localDate()) && (
        <ActionButton size="icon-xs"
          className="icon-button task-action"
          disabled={!!completion}
          aria-label={`Schedule ${item.title} for today`}
          onClick={() => onChange(item, { scheduledAt: todaySchedule() }, "Scheduled for today")}
        >
          <CalendarPlus size="0.9375rem" />
        </ActionButton>
      )}
      <ActionButton size="icon-xs" className="task-action"
        disabled={!!completion}
        aria-label={`Edit ${item.title}`} onClick={() => onOpen(item)}>
        <Pencil size="0.875rem" />
      </ActionButton>
      <Popover open={priorityOpen} onOpenChange={open => {
        setPriorityOpen(open);
        if (open) setActionsOpen(false);
      }}>
        <PopoverTrigger asChild>
          <ActionButton size="icon-xs"
            className={`task-priority-button priority-${item.task.priority}`}
            disabled={!!completion}
            aria-label={`Set priority for ${item.title} (P${item.task.priority})`}>
            <Flag size="1rem" />
          </ActionButton>
        </PopoverTrigger>
        <PopoverContent className="task-priority-menu" align="end" aria-label={`Priority for ${item.title}`}>
          <strong className="task-actions-heading">Priority</strong>
          {([1, 2, 3, 4] as const).map(priority => (
            <Button key={priority} variant="ghost" size="sm"
              className={`task-menu-action priority-${priority}`}
              aria-pressed={item.task.priority === priority}
              onClick={() => {
                if (priority !== item.task.priority)
                  onChange(item, { priority: priority < 4, task: { ...item.task, priority } }, `Priority set to P${priority}`);
                setPriorityOpen(false);
              }}>
              <Flag size="0.875rem" />P{priority}{priority === 4 ? " · Normal" : ""}
            </Button>
          ))}
        </PopoverContent>
      </Popover>
      <Popover open={actionsOpen} onOpenChange={open => {
        setActionsOpen(open);
        if (open) setPriorityOpen(false);
        else setContextPoint(null);
      }}>
        {contextPoint && <PopoverAnchor asChild>
          <span style={{ position: "fixed", left: contextPoint.x, top: contextPoint.y }} />
        </PopoverAnchor>}
        <PopoverTrigger asChild>
          <ActionButton size="icon-xs" className="task-action"
            disabled={!!completion}
            aria-label={`Actions for ${item.title}`}
            onClick={() => { setContextPoint(null); setActionView("actions"); }}>
            <MoreHorizontal size="1rem" />
          </ActionButton>
        </PopoverTrigger>
        <PopoverContent className={cn("task-actions-menu", actionView === "date" && "task-actions-date")}
          align={contextPoint ? "start" : "end"} aria-label={`Actions for ${item.title}`}>
          {actionView === "actions" ? <>
            <strong className="task-actions-heading">Task actions</strong>
            <Button variant="ghost" size="sm" className="task-menu-action" onClick={() => schedule(todaySchedule())}>
              <CalendarPlus size="0.875rem" />Today
            </Button>
            <Button variant="ghost" size="sm" className="task-menu-action" onClick={() => {
              const tomorrow = new Date(todaySchedule());
              tomorrow.setDate(tomorrow.getDate() + 1);
              schedule(tomorrow.toISOString());
            }}>
              <CalendarDays size="0.875rem" />Tomorrow
            </Button>
            <Button variant="ghost" size="sm" className="task-menu-action" onClick={() => {
              setScheduled(new Date(item.scheduledAt ?? todaySchedule()));
              setActionView("date");
            }}>
              <CalendarDays size="0.875rem" />Pick date
            </Button>
            <Button variant="ghost" size="sm" className="task-menu-action" onClick={() => schedule(null)}>
              <CalendarOff size="0.875rem" />No date
            </Button>
            {item.recurrence !== "none" && <p className="task-actions-note">No date also turns off repeat.</p>}
            <Button variant="ghost" size="sm" className="task-menu-action" disabled={shared}
              onClick={() => setActionView("project")}>
              <FolderInput size="0.875rem" />Move project
            </Button>
            {shared && <p className="task-actions-note">Shared tasks stay in their shared project.</p>}
            <Button variant="ghost" size="sm" className="task-menu-action danger" onClick={() => {
              setActionsOpen(false);
              onDelete(item);
            }}>
              <Trash2 size="0.875rem" />Delete
            </Button>
          </> : actionView === "date" ? <>
            <Button variant="ghost" size="sm" className="task-actions-back" onClick={() => setActionView("actions")}>
              <ChevronLeft size="0.875rem" />Pick date
            </Button>
            <Calendar mode="single" selected={scheduled} defaultMonth={scheduled}
              onSelect={day => {
                if (!day) return;
                const next = new Date(day);
                next.setHours(scheduled.getHours(), scheduled.getMinutes(), 0, 0);
                setScheduled(next);
              }} />
            <div className="task-actions-time">
              <span>Time</span>
              <TimePicker label={`Schedule ${item.title} time`} value={scheduled.toTimeString().slice(0, 5)}
                onChange={time => {
                  const [hour, minute] = time.split(":").map(Number);
                  const next = new Date(scheduled);
                  next.setHours(hour!, minute!, 0, 0);
                  setScheduled(next);
                }} />
            </div>
            <Button size="sm" onClick={() => schedule(scheduled.toISOString())}>Set date</Button>
          </> : <>
            <Button variant="ghost" size="sm" className="task-actions-back" onClick={() => setActionView("actions")}>
              <ChevronLeft size="0.875rem" />Move project
            </Button>
            <Select value={item.task.projectId ?? "none"} onValueChange={moveProject}>
              <SelectTrigger className="task-actions-project" aria-label={`Move ${item.title} to project`}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No project</SelectItem>
                {snapshot.workspace.projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </>}
        </PopoverContent>
      </Popover>
    </div>
  );
});

export function LabelPicker({ value, suggestions, onChange }: {
  value: string[]; suggestions: string[]; onChange: (labels: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const query = text.trim().replace(/^@/, "").toLowerCase();
  const matches = [...new Set(suggestions)].filter(label => !value.includes(label) && label.toLowerCase().includes(query)).slice(0, 6);
  function add(label: string) {
    const clean = label.trim().replace(/^@/, "");
    if (clean && !value.includes(clean)) onChange([...value, clean]);
    setText("");
  }
  return (
    <div className="label-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <div className="label-picker-field">
        {value.map(label => <span className="label-chip" key={label}>@{label}
          <button type="button" aria-label={`Remove label ${label}`} onClick={() => onChange(value.filter(tag => tag !== label))}><X size="0.75rem" /></button>
        </span>)}
        <input aria-label="Add label" value={text} maxLength={40} placeholder={value.length ? "" : "Add labels…"}
          onFocus={() => setOpen(true)}
          onChange={event => { setText(event.target.value.replaceAll(",", "")); setOpen(true); }}
          onKeyDown={event => {
            if ((event.key === "Enter" || event.key === ",") && query) {
              event.preventDefault();
              add(matches.find(label => label.toLowerCase() === query) ?? text);
            } else if (event.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }} />
      </div>
      {open && matches.length > 0 && <div className="label-suggestions" aria-label="Label suggestions">
        {matches.map(label => <button type="button" key={label} onMouseDown={event => event.preventDefault()} onClick={() => add(label)}>@{label}</button>)}
      </div>}
    </div>
  );
}

/** Phrases understood from typed text; removing one keeps it in the title. */
export function RecognizedTokens({ tokens, onKeep }: { tokens: string[]; onKeep: (token: string) => void }) {
  if (!tokens.length) return null;
  return (
    <div className="recognized-tokens" role="status" aria-label="Recognized details">
      {tokens.map((token, index) => <span className="recognized-token" key={index}>{token}
        <button type="button" aria-label={`Keep “${token}” as text`} title="Keep as text" onClick={() => onKeep(token)}><X size="0.75rem" /></button>
      </span>)}
    </div>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <FileText size="1.625rem" />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

export function Shortcut({ value }: { value: string }) {
  const mac = navigator.platform.includes("Mac");
  const labels: Record<string, string> = {
    CommandOrControl: mac ? "⌘" : "Ctrl",
    Command: mac ? "⌘" : "Cmd",
    Control: mac ? "⌃" : "Ctrl",
    Shift: mac ? "⇧" : "Shift",
    Alt: mac ? "⌥" : "Alt",
    Option: mac ? "⌥" : "Alt",
  };
  return (
    <KbdGroup aria-label={value.replace("CommandOrControl", mac ? "Command" : "Control").replaceAll("+", " + ")}>
      {value.split("+").map((key, index) => <Kbd key={index}>{labels[key] ?? key}</Kbd>)}
    </KbdGroup>
  );
}
