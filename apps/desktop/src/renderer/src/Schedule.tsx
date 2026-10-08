import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { localDate, type Item, type Snapshot } from "@dock/contracts";
import { Empty, TaskRow } from "./components";
import type { Act } from "./state";

export function Schedule({
  snapshot,
  act,
  onOpen,
}: {
  snapshot: Snapshot;
  act: Act;
  onOpen: (item: Item) => void;
}) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [selected, setSelected] = useState(localDate());
  const start = new Date(
    month.getFullYear(),
    month.getMonth(),
    1 - ((month.getDay() + 6) % 7),
  );
  const tasks = snapshot.items.filter(
    (item) => item.kind === "task" && !item.done && item.scheduledAt,
  );
  const selectedTasks = tasks
    .filter((item) => localDate(new Date(item.scheduledAt!)) === selected)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  return (
    <>
      <div className="calendar-heading">
        <h2>
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <div>
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="secondary"
            onClick={() => {
              setMonth(
                new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              );
              setSelected(localDate());
            }}
          >
            Today
          </button>
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day} className="weekday">
            {day}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, index) => {
          const date = new Date(
            start.getFullYear(),
            start.getMonth(),
            start.getDate() + index,
          );
          const key = localDate(date);
          const count = tasks.filter(
            (item) => localDate(new Date(item.scheduledAt!)) === key,
          ).length;
          return (
            <button
              key={key}
              aria-label={`${date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${count ? `, ${count} tasks` : ""}`}
              aria-pressed={selected === key}
              className={`calendar-day ${selected === key ? "selected" : ""} ${key === localDate() ? "current" : ""} ${date.getMonth() !== month.getMonth() ? "outside" : ""}`}
              onClick={() => setSelected(key)}
            >
              <span>{date.getDate()}</span>
              {count > 0 && <i />}
            </button>
          );
        })}
      </div>
      <div className="group-label">
        <span>
          {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </span>
        <span>{selectedTasks.length} tasks</span>
      </div>
      {selectedTasks.length ? (
        selectedTasks.map((item) => (
          <TaskRow
            key={item.id}
            item={item}
            snapshot={snapshot}
            act={act}
            onOpen={onOpen}
          />
        ))
      ) : (
        <Empty title="A little breathing room">
          No tasks scheduled for this day.
        </Empty>
      )}
      <p className="muted reminder-note">
        Reminders run while Dock is open or in the tray. Late reminders are
        checked after sleep.
      </p>
    </>
  );
}
