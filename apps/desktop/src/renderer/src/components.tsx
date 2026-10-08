import { Check, FileText, Link2, Repeat2, Star } from "lucide-react";
import { localDate, type Item, type Snapshot } from "@dock/contracts";
import type { Act } from "./state";

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
}: {
  item: Item;
  snapshot: Snapshot;
  act: Act;
  onOpen: (item: Item) => void;
}) {
  const note = snapshot.items.find((note) => note.id === item.linkedNoteId);
  return (
    <div className={`task-row ${item.done ? "completed" : ""}`}>
      <button
        className={`check ${item.done ? "done" : ""}`}
        aria-label={`${item.done ? "Reopen" : "Complete"} ${item.title}`}
        onClick={() => act({ type: "item.toggle", id: item.id })}
      >
        {item.done && <Check size={12} />}
      </button>
      <button className="task-open" onClick={() => onOpen(item)}>
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
      </button>
      <button
        className={`icon-button ${item.priority ? "starred" : ""}`}
        aria-label={`${item.priority ? "Remove priority from" : "Prioritize"} ${item.title}`}
        onClick={() => act({ type: "item.priority", id: item.id })}
      >
        <Star size={17} />
      </button>
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
  return (
    <kbd>
      {value
        .replace(
          "CommandOrControl",
          navigator.platform.includes("Mac") ? "Cmd" : "Ctrl",
        )
        .replaceAll("+", " + ")}
    </kbd>
  );
}
