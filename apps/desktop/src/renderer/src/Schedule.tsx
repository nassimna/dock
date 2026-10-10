import { useState, type ReactNode } from "react";
import { localDate, type Item } from "@dock/contracts";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Empty } from "./components";

export function Schedule({ items, renderTasks }: {
  items: Item[];
  renderTasks: (items: Item[]) => ReactNode;
}) {
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(localDate());
  const tasks = items.filter(item => item.kind === "task" && !item.done && item.scheduledAt);
  const selectedTasks = tasks
    .filter(item => localDate(new Date(item.scheduledAt!)) === selected)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  return (
    <>
      <div className="schedule-layout">
      <div>
      <div className="calendar-heading">
        <p className="muted">Select a day to see its tasks.</p>
        <Button variant="outline" size="sm" onClick={() => {
          setMonth(new Date());
          setSelected(localDate());
        }}>Today</Button>
      </div>
      <Calendar mode="single" required selected={new Date(`${selected}T12:00:00`)}
        onSelect={date => setSelected(localDate(date))} month={month} onMonthChange={setMonth}
        weekStartsOn={1} fixedWeeks className="schedule-calendar"
        modifiers={{ hasTasks: tasks.map(item => new Date(item.scheduledAt!)) }}
        modifiersClassNames={{ hasTasks: "has-tasks" }} />
      </div>
      <section aria-label="Tasks on selected day">
      <div className="group-label">
        <span>{new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
          weekday: "long", month: "long", day: "numeric",
        })}</span>
        <span>{selectedTasks.length} tasks</span>
      </div>
      {selectedTasks.length ? renderTasks(selectedTasks)
        : <Empty title="A little breathing room">No tasks scheduled for this day.</Empty>}
      </section>
      </div>
      <p className="muted reminder-note">Reminders run while Dock is open or in the tray. Late reminders are checked after sleep.</p>
    </>
  );
}
