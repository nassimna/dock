import { useEffect, useRef, useState, type ReactNode } from 'react';
import { localDate, type Item, type Snapshot } from '@dock/contracts';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { ChevronLeft, ChevronRight, CalendarDays, List, Plus } from 'lucide-react';
import { Empty } from './components';
import type { Dispatch } from './state';
export function Schedule({ items, renderTasks, snapshot, dispatch, onOpen, onAdd }: { items: Item[]; renderTasks: (items: Item[]) => ReactNode; snapshot: Snapshot; dispatch: Dispatch; onOpen: (item: Item) => void; onAdd: (scheduledAt: string) => void; }) {
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(localDate());
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [offset, setOffset] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const [focusedSlot, setFocusedSlot] = useState(18);
  const [resizing, setResizing] = useState<{ id: string; minutes: number } | null>(null);
  // Read synchronously by pointer handlers, so a quick drag works before React re-renders.
  const resizeStart = useRef<{ id: string; startY: number } | null>(null);
  const resize = (item: Item, minutes: number) => {
    const durationMinutes = Math.max(15, Math.min(1440, Math.round(minutes / 15) * 15));
    if (durationMinutes !== item.task.durationMinutes)
      void dispatch({ type: 'item.save', item: { ...item, expectedRevision: item.revision, task: { ...item.task, durationMinutes } } }).catch(() => { });
  };
  const hourHeight = () => document.querySelector('.week-hours span')!.getBoundingClientRect().height;
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 7 * hourHeight(); }, [mode]);
  const tasks = items.filter(item => item.kind === 'task' && !item.done);
  const selectedTasks = tasks.filter(item => item.scheduledAt && localDate(new Date(item.scheduledAt)) === selected).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7 + offset * 7);
  const days = Array.from({ length: 7 }, (_, index) => { const day = new Date(start); day.setDate(day.getDate() + index); return day; });
  return <>
    <div className="calendar-toolbar">
      <div className="view-switch">
        <Button variant={mode === 'week' ? 'secondary' : 'ghost'} size="xs" onClick={() => setMode('week')}>
          <CalendarDays size="0.9375rem" />Week
        </Button>
        <Button variant={mode === 'month' ? 'secondary' : 'ghost'} size="xs" onClick={() => setMode('month')}>
          <List size="0.9375rem" />Month &amp; list
        </Button>
      </div>
      <div className="detail-line">
        <Button size="xs" onClick={() => {
          const day = mode === 'month' ? new Date(`${selected}T09:00:00`) : new Date();
          if (mode === 'week') { day.setDate(day.getDate() + offset * 7); day.setHours(9, 0, 0, 0); }
          onAdd(day.toISOString());
        }}><Plus size="0.9375rem" />New task</Button>
        <Button variant="outline" size="xs" onClick={() => { setMonth(new Date()); setSelected(localDate()); setOffset(0); }}>Today</Button>
        {mode === 'week' && <>
          <Button variant="ghost" size="icon-xs" aria-label="Previous week" onClick={() => setOffset(offset - 1)}>
            <ChevronLeft size="1rem" />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Next week" onClick={() => setOffset(offset + 1)}>
            <ChevronRight size="1rem" />
          </Button>
          <span>
            {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} –{' '}
            {days[6]!.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        </>}
      </div>
    </div>
    {mode === 'month' ? <div className="schedule-layout">
      <div>
        <Calendar
          mode="single"
          required
          selected={new Date(`${selected}T12:00:00`)}
          onSelect={date => setSelected(localDate(date))}
          month={month}
          onMonthChange={setMonth}
          weekStartsOn={1}
          fixedWeeks
          className="schedule-calendar"
          modifiers={{ hasTasks: tasks.filter(item => item.scheduledAt).map(item => new Date(item.scheduledAt!)) }}
          modifiersClassNames={{ hasTasks: 'has-tasks' }} />
      </div>
      <section aria-label="Tasks on selected day">
        <div className="group-label">
          <span>
            {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
          <span>{selectedTasks.length} tasks</span>
        </div>
        {selectedTasks.length ? renderTasks(selectedTasks) : <Empty title="A little breathing room">No tasks scheduled for this day.</Empty>}
      </section>
    </div> : <>
      <section className="unscheduled-tray" aria-label="Unscheduled tasks">
        <strong>Unscheduled</strong>
        <span className="muted">Click an empty time to add a task, or drag a task to schedule it.</span>
        <div>
          {tasks.filter(item => !item.scheduledAt && !item.task.parentId).map(item => <Button
            variant="outline"
            size="xs"
            key={item.id}
            draggable
            onDragStart={event => event.dataTransfer.setData('text/plain', item.id)}
            onClick={() => onOpen(item)}>
            {item.title}
            <small>{item.task.durationMinutes}m</small>
          </Button>)}
        </div>
      </section>
      <div className="week-scroll" ref={scroll}>
        <div className="week-grid">
          <div className="week-corner">Time</div>
          {days.map(day => <div className={`week-day-heading ${localDate(day) === localDate() ? 'today' : ''}`} key={localDate(day)}>
            {day.toLocaleDateString(undefined, { weekday: 'short' })}
            <strong>{day.getDate()}</strong>
          </div>)}
          <div className="deadline-label">Deadlines</div>
          {days.map(day => <div className="deadline-cell" key={localDate(day)}>
            {tasks.filter(item => item.task.deadline && localDate(new Date(item.task.deadline)) === localDate(day)).map(item => <Button variant="ghost" size="xs" key={item.id} onClick={() => onOpen(item)}>{item.title}</Button>)}
          </div>)}
          <div className="week-hours">
            {Array.from({ length: 24 }, (_, hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}
          </div>
          {days.map(day => {
            const dayTasks = tasks.filter(item => item.scheduledAt && localDate(new Date(item.scheduledAt)) === localDate(day)).sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!));
            const lanes: number[] = [];
            const blocks = dayTasks.map(item => item.id === resizing?.id ? { ...item, task: { ...item.task, durationMinutes: resizing.minutes } } : item).map(item => {
              const time = new Date(item.scheduledAt!);
              const minute = time.getHours() * 60 + time.getMinutes();
              let lane = lanes.findIndex(end => end <= minute);
              if (lane === -1) lane = lanes.length;
              lanes[lane] = minute + item.task.durationMinutes;
              return { item, minute, lane };
            });
            return <div className="week-day" key={localDate(day)} aria-label={localDate(day)}>
              {Array.from({ length: 48 }, (_, slot) => <button
                type="button"
                className="week-slot"
                key={slot}
                aria-label={`${localDate(day)} ${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`}
                tabIndex={slot === focusedSlot ? 0 : -1}
                onFocus={() => setFocusedSlot(slot)}
                onClick={() => {
                  const time = new Date(day); time.setHours(Math.floor(slot / 2), slot % 2 * 30, 0, 0);
                  onAdd(time.toISOString());
                }}
                onKeyDown={event => {
                  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                  event.preventDefault();
                  const columns = Array.from(event.currentTarget.closest('.week-grid')!.querySelectorAll<HTMLElement>('.week-day'));
                  const index = days.findIndex(value => localDate(value) === localDate(day));
                  const nextDay = index + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0);
                  const nextSlot = slot + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0);
                  columns[nextDay]?.querySelectorAll<HTMLButtonElement>('.week-slot')[nextSlot]?.focus();
                }}
                onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
                onDrop={event => {
                  event.preventDefault();
                  const item = snapshot.items.find(item => item.id === event.dataTransfer.getData('text/plain'));
                  if (!item || item.kind !== 'task') return;
                  const time = new Date(day);
                  time.setHours(Math.floor(slot / 2), slot % 2 * 30);
                  void dispatch({ type: 'item.save', item: { ...item, expectedRevision: item.revision, scheduledAt: time.toISOString() } }).catch(() => { });
                }} />)}
              {blocks.map(({ item, minute, lane }) => <button
                type="button"
                key={item.id}
                draggable
                className={`calendar-block priority-${item.task.priority}`}
                style={{
                  top: `calc(${minute / 60} * var(--hour-height))`,
                  height: `calc(${Math.min(item.task.durationMinutes, 1440 - minute) / 60} * var(--hour-height))`,
                  left: `calc(${lane / lanes.length * 100}% + 0.125rem)`,
                  width: `calc(${100 / lanes.length}% - 0.25rem)`
                }}
                onDragStart={event => event.dataTransfer.setData('text/plain', item.id)}
                onClick={() => onOpen(item)}
                onKeyDown={event => {
                  if (!event.shiftKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  resize(item, item.task.durationMinutes + (event.key === 'ArrowDown' ? 15 : -15));
                }}
                title={`${item.title} · ${new Date(item.scheduledAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${item.task.durationMinutes}m · Drag the bottom edge or press Shift+↑/↓ to change length`}>
                <strong>{item.title}</strong>
                {item.task.durationMinutes >= 45 && <small>
                  {new Date(item.scheduledAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·
                  {item.task.durationMinutes}m
                </small>}
                <span className="calendar-resize" aria-hidden="true"
                  onMouseDown={event => event.preventDefault()}
                  onClick={event => event.stopPropagation()}
                  onPointerDown={event => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    resizeStart.current = { id: item.id, startY: event.clientY };
                    setResizing({ id: item.id, minutes: item.task.durationMinutes });
                  }}
                  onPointerMove={event => {
                    const start = resizeStart.current;
                    if (start?.id !== item.id) return;
                    const original = snapshot.items.find(task => task.id === item.id)!.task.durationMinutes;
                    setResizing({ id: item.id, minutes: Math.max(15, Math.round((original + (event.clientY - start.startY) / hourHeight() * 60) / 15) * 15) });
                  }}
                  onPointerUp={event => {
                    const start = resizeStart.current;
                    if (start?.id !== item.id) return;
                    resizeStart.current = null;
                    setResizing(null);
                    const original = snapshot.items.find(task => task.id === item.id)!;
                    resize(original, original.task.durationMinutes + (event.clientY - start.startY) / hourHeight() * 60);
                  }}
                  onPointerCancel={() => { resizeStart.current = null; setResizing(null); }} />
              </button>)}
            </div>;
          })}
        </div>
      </div>
    </>}
    <p className="muted reminder-note">Reminders run while Rivnote is open or in the tray. Late reminders are checked after sleep.</p>
  </>;
}
