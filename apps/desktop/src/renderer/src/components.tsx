import { Button, type ButtonProps } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { CalendarPlus, FileText, Link2, Pencil, Repeat2, Star } from "lucide-react";
import { localDate, type Item, type Snapshot } from "@dock/contracts";
import type { Act } from "./state";

export function todaySchedule(): string {
  const date = new Date();
  date.setHours(23, 59, 0, 0);
  return date.toISOString();
}

export function ActionButton({ className, ...props }: ButtonProps & { "aria-label": string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("icon-button", className)} {...props} />
      </TooltipTrigger>
      <TooltipContent>{props["aria-label"]}</TooltipContent>
    </Tooltip>
  );
}

export function dueLabel(item: Item): string {
  if (!item.scheduledAt) return "No date";
  const date = new Date(item.scheduledAt);
  const today = localDate();
  const day = localDate(date);
  const label =
    day === today
      ? "Today"
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day < today && !item.done ? "Overdue · " : ""}${label} · ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

export function TaskRow({
  item,
  snapshot,
  act,
  onOpen,
  onToggle,
  completion,
}: {
  item: Item;
  snapshot: Snapshot;
  act: Act;
  onOpen: (item: Item) => void;
  onToggle: (item: Item) => void;
  completion?: "saving" | "complete";
}) {
  const note = snapshot.items.find((note) => note.id === item.linkedNoteId);
  const done = item.done || completion === "complete";
  return (
    <div className={cn("task-row", done && "completed", completion === "complete" && "task-completing")}
      aria-busy={completion === "saving"}>
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
          <span>{item.space}</span>
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
              <Repeat2 size={12} />
              <span>{item.recurrence}</span>
            </>
          )}
          {note && (
            <>
              <Link2 size={12} />
              <span>{note.title}</span>
            </>
          )}
        </span>
      </Button>
      {!item.done && (!item.scheduledAt || localDate(new Date(item.scheduledAt)) !== localDate()) && (
        <ActionButton
          className="icon-button task-action"
          disabled={!!completion}
          aria-label={`Schedule ${item.title} for today`}
          onClick={() => act({ type: "item.save", item: {
            ...item, expectedRevision: item.revision, scheduledAt: todaySchedule(),
          } })}
        >
          <CalendarPlus size={15} />
        </ActionButton>
      )}
      <ActionButton className="task-action"
        disabled={!!completion}
        aria-label={`Edit ${item.title}`} onClick={() => onOpen(item)}>
        <Pencil size={14} />
      </ActionButton>
      <ActionButton
        className={`icon-button ${item.priority ? "starred" : ""}`}
        aria-pressed={item.priority}
        disabled={!!completion}
        aria-label={`${item.priority ? "Remove priority from" : "Prioritize"} ${item.title}`}
        onClick={() => act({ type: "item.priority", id: item.id })}
      >
        <Star size={17} />
      </ActionButton>
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
      <FileText size={26} />
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
