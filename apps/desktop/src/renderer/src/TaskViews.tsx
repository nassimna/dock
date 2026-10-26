import { useEffect, useMemo, useRef, useState } from 'react';
import { localDate, type Item, type Project, type Snapshot, type Workspace } from '@dock/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ArrowLeft, ArrowRight, Columns3, EyeOff, MessageSquare, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dueLabel, Empty } from './components';
import { errorMessage, type Dispatch } from './state';
const columnType = 'application/x-dock-column';

export function ProjectBoard({ project, items, snapshot, dispatch, onOpen, onAdd, onToggle }: { project: Project; items: Item[]; snapshot: Snapshot; dispatch: Dispatch; onOpen: (item: Item) => void; onAdd: (sectionId: string | null) => void; onToggle: (item: Item) => void; }) {
  const hidden = project.hiddenColumns ?? [];
  const columns = [{ id: null, name: 'No section' }, ...project.sections];
  const sections = columns.filter(section => !hidden.includes(section.id ?? 'none'));
  const shared = snapshot.syncFeatures.projects.find(shared => shared.id === project.id);
  const canManage = !shared || shared.ownerEmail === snapshot.sync.email;
  const [focusCard, setFocusCard] = useState<string | null>(null);
  useEffect(() => {
    if (!focusCard) return;
    const button = document.querySelector<HTMLButtonElement>(`.board-card[data-task-id="${focusCard}"] .board-card-title button[title]`);
    if (button) { button.focus(); setFocusCard(null); }
  }, [focusCard, items]);
  const [drop, setDrop] = useState<{ sectionId: string | null; index: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionsColumn, setActionsColumn] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const columnTrigger = useRef<HTMLButtonElement>(null);
  const addColumnButton = useRef<HTMLButtonElement>(null);
  const deletingColumn = project.sections.find(section => section.id === confirmDelete);
  const affectedTasks = confirmDelete ? snapshot.items.filter(item => item.kind === 'task' && item.task.projectId === project.id && item.task.sectionId === confirmDelete).length : 0;
  const childCounts = useMemo(() => {
    const counts = new Map<string, { total: number; done: number }>();
    for (const child of snapshot.items) {
      if (!child.task.parentId) continue;
      const count = counts.get(child.task.parentId) ?? { total: 0, done: 0 };
      count.total++;
      if (child.done) count.done++;
      counts.set(child.task.parentId, count);
    }
    return counts;
  }, [snapshot.items]);
  const column = (sectionId: string | null) => items.filter(item => item.task.sectionId === sectionId);
  async function saveProject(next: Project) {
    await dispatch({ type: 'workspace.save', workspace: { ...snapshot.workspace, projects: snapshot.workspace.projects.map(item => item.id === next.id ? next : item) } });
    if (shared) await dispatch({ type: 'sync.project.share', project: next });
  }
  const save = (next: Partial<Project>) => void saveProject({ ...project, ...next }).catch(() => { });
  const setHidden = (id: string | null, hide: boolean) =>
    save({ hiddenColumns: hide ? [...hidden, id ?? 'none'] : hidden.filter(column => column !== (id ?? 'none')) });
  function moveColumn(id: string, index: number) {
    const others = project.sections.filter(section => section.id !== id);
    const target = Math.max(0, Math.min(others.length, index));
    save({ sections: [...others.slice(0, target), project.sections.find(section => section.id === id)!, ...others.slice(target)] });
  }
  function rename(id: string, name: string) {
    setRenaming(null);
    if (name.trim() && name.trim() !== project.sections.find(section => section.id === id)?.name)
      save({ sections: project.sections.map(section => section.id === id ? { ...section, name: name.trim() } : section) });
  }
  async function move(item: Item, sectionId: string | null, index: number) {
    const current = column(sectionId);
    const others = current.filter(card => card.id !== item.id);
    const ordered = [...others.slice(0, index), item, ...others.slice(index)];
    if (item.task.sectionId === sectionId && ordered.every((card, position) => card.id === current[position]?.id)) return;
    await dispatch({ type: 'item.reorder', projectId: project.id, sectionId,
      ids: ordered.map(card => card.id),
      expectedRevisions: Object.fromEntries(ordered.map(card => [card.id, card.revision])),
    });
  }
  async function deleteColumn() {
    if (!deletingColumn || !canManage) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await saveProject({ ...project,
        sections: project.sections.filter(section => section.id !== deletingColumn.id),
        hiddenColumns: hidden.filter(id => id !== deletingColumn.id && (!affectedTasks || id !== 'none')),
      });
      setConfirmDelete(null);
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }
  function moveByKey(event: React.KeyboardEvent, item: Item) {
    if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const sectionIndex = sections.findIndex(section => section.id === item.task.sectionId);
    const index = column(item.task.sectionId).indexOf(item);
    const target = event.key === 'ArrowLeft' ? sections[sectionIndex - 1] : event.key === 'ArrowRight' ? sections[sectionIndex + 1] : sections[sectionIndex];
    if (!target) return;
    const nextIndex = target.id !== item.task.sectionId ? column(target.id).length : Math.max(0, index + (event.key === 'ArrowUp' ? -1 : 1));
    void move(item, target.id, nextIndex).then(() => setFocusCard(item.id), () => { });
  }
  return <>
    <div className="list-toolbar">
      <span className="muted">{items.length} {items.length === 1 ? 'task' : 'tasks'}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs"><Columns3 size="0.8125rem" />Columns{hidden.length > 0 && <span className="muted"> · {hidden.length} hidden</span>}</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="board-columns-menu" aria-label="Board columns">
          <strong>Show columns</strong>
          {columns.map(section => <Label className="checkbox-label" key={section.id ?? 'none'}>
            <Checkbox checked={!hidden.includes(section.id ?? 'none')} disabled={!canManage}
              onCheckedChange={value => setHidden(section.id, value !== true)} />{section.name}
            <small>{column(section.id).length}</small>
          </Label>)}
          {hidden.length > 0 && <Button variant="ghost" size="xs" disabled={!canManage} onClick={() => save({ hiddenColumns: [] })}>Show all</Button>}
          {!canManage && <p className="muted">Only the project owner can change columns.</p>}
        </PopoverContent>
      </Popover>
    </div>
    <div className="project-board" aria-label="Project board" onDragEnd={() => setDrop(null)}>
    {!sections.length && <Empty title="All columns are hidden">Use Columns to show them again.</Empty>}
    {sections.map(section => {
      const cards = column(section.id);
      const marker = (index: number) => drop?.sectionId === section.id && drop.index === index && <div className="board-drop-marker" aria-hidden="true" />;
      const position = section.id ? project.sections.findIndex(item => item.id === section.id) : -1;
      return <section
        className="board-column"
        key={section.id ?? 'none'}
        aria-label={section.name}
        onDragOver={event => {
          event.preventDefault();
          if (event.target === event.currentTarget && !event.dataTransfer.types.includes(columnType)) setDrop({ sectionId: section.id, index: cards.length });
        }}
        onDrop={event => {
          event.preventDefault();
          const dragged = event.dataTransfer.getData(columnType);
          if (dragged) {
            if (section.id && dragged !== section.id) moveColumn(dragged, position - (project.sections.findIndex(item => item.id === dragged) < position ? 1 : 0));
            return;
          }
          const item = items.find(item => item.id === event.dataTransfer.getData('text/plain'));
          const index = drop?.sectionId === section.id ? drop.index : cards.length;
          setDrop(null);
          if (item) void move(item, section.id, index - (item.task.sectionId === section.id && cards.indexOf(item) < index ? 1 : 0)).catch(() => { });
        }}>
        <div className="board-heading" draggable={canManage && !!section.id && renaming !== section.id}
          onDragStart={event => { if (section.id) event.dataTransfer.setData(columnType, section.id); }}>
          {renaming === section.id && section.id ? <Input size="xs" aria-label={`Rename ${section.name}`} defaultValue={section.name} maxLength={100} autoFocus
            onBlur={event => rename(section.id!, event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); rename(section.id!, event.currentTarget.value); }
              if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); }
            }} /> : <h2 onDoubleClick={() => { if (canManage && section.id) setRenaming(section.id); }}>{section.name}</h2>}
          <small>{cards.length}</small>
          <Button variant="ghost" size="icon-xs" aria-label={`Add task in ${section.name}`} onClick={() => onAdd(section.id)}>
            <Plus size="1rem" />
          </Button>
          <Popover open={actionsColumn === (section.id ?? 'none')} onOpenChange={open => setActionsColumn(open ? section.id ?? 'none' : null)}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`Column actions for ${section.name}`} disabled={!canManage} onClick={event => { columnTrigger.current = event.currentTarget; }}><MoreHorizontal size="1rem" /></Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="task-actions-menu" aria-label={`Column actions for ${section.name}`} onCloseAutoFocus={event => { if (confirmDelete) event.preventDefault(); }}>
              <strong className="task-actions-heading">{section.name}</strong>
              {section.id && <>
                <Button variant="ghost" size="sm" className="task-menu-action" onClick={() => setRenaming(section.id)}><Pencil size="0.875rem" />Rename</Button>
                <Button variant="ghost" size="sm" className="task-menu-action" disabled={position === 0} onClick={() => moveColumn(section.id!, position - 1)}><ArrowLeft size="0.875rem" />Move left</Button>
                <Button variant="ghost" size="sm" className="task-menu-action" disabled={position === project.sections.length - 1} onClick={() => moveColumn(section.id!, position + 1)}><ArrowRight size="0.875rem" />Move right</Button>
              </>}
              <Button variant="ghost" size="sm" className="task-menu-action" onClick={() => setHidden(section.id, true)}><EyeOff size="0.875rem" />Hide column</Button>
              {section.id && <Button variant="ghost" size="sm" className="task-menu-action danger"
                onClick={() => { setActionsColumn(null); setDeleteError(''); setConfirmDelete(section.id); }}>
                <Trash2 size="0.875rem" />Delete column
              </Button>}
            </PopoverContent>
          </Popover>
        </div>
        {cards.map((item, index) => {
          const children = childCounts.get(item.id);
          return <div key={item.id}>
            {marker(index)}
            <article
              className={`board-card priority-${item.task.priority}`}
              data-task-id={item.id}
              draggable
              onDragStart={event => event.dataTransfer.setData('text/plain', item.id)}
              onDragOver={event => {
                if (event.dataTransfer.types.includes(columnType)) return;
                const box = event.currentTarget.getBoundingClientRect();
                setDrop({ sectionId: section.id, index: event.clientY < box.top + box.height / 2 ? index : index + 1 });
              }}>
              <div className="board-card-title">
                <Checkbox checked={item.done} aria-label={`Complete ${item.title}`} onCheckedChange={() => onToggle(item)} />
                <Button variant="ghost" onClick={() => onOpen(item)} onKeyDown={event => moveByKey(event, item)}
                  title="Option+arrow keys move this card">{item.title}</Button>
              </div>
              {item.body && <p>{item.body.slice(0, 130)}</p>}
              <div className="task-meta">
                {item.scheduledAt && <span>{dueLabel(item)}</span>}
                {item.tags.map(tag => <span className="task-label" key={tag}>@{tag}</span>)}
                {children && <span>{children.done}/{children.total} subtasks</span>}
                {item.task.comments.length > 0 && <span><MessageSquare size="0.75rem" /> {item.task.comments.length}</span>}
                {item.task.assignee && <span>{item.task.assignee}</span>}
              </div>
            </article>
          </div>;
        })}
        {marker(cards.length)}
        <Button variant="ghost" size="xs" className="board-add" onClick={() => onAdd(section.id)}>
          <Plus size="0.8125rem" />Add task
        </Button>
      </section>;
    })}
    {canManage && <div className="board-new-column">
      {adding ? <Input size="xs" aria-label="New column name" placeholder="Column name" maxLength={100} autoFocus
        onBlur={() => setAdding(false)}
        onKeyDown={event => {
          if (event.key === 'Escape') setAdding(false);
          if (event.key === 'Enter' && event.currentTarget.value.trim()) {
            event.preventDefault();
            save({ sections: [...project.sections, { id: crypto.randomUUID(), name: event.currentTarget.value.trim() }] });
            setAdding(false);
          }
        }} /> : <Button ref={addColumnButton} variant="ghost" size="xs" onClick={() => setAdding(true)}><Plus size="0.8125rem" />Add column</Button>}
    </div>}
    </div>
    <Dialog open={confirmDelete !== null} onOpenChange={open => { if (!open && !deleting) setConfirmDelete(null); }}>
      <DialogContent onCloseAutoFocus={event => {
        event.preventDefault();
        (columnTrigger.current?.isConnected ? columnTrigger.current : addColumnButton.current)?.focus();
      }}>
        <DialogHeader>
          <DialogTitle>Delete {deletingColumn?.name ?? 'this'} column?</DialogTitle>
          <DialogDescription>
            {affectedTasks ? `${affectedTasks} task${affectedTasks === 1 ? '' : 's'} will move to No section, including completed tasks and subtasks. No tasks will be deleted.` : 'This empty column will be removed. No tasks will be deleted.'}
          </DialogDescription>
        </DialogHeader>
        {deleteError && <p role="alert">{deleteError}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button variant="destructive" disabled={deleting || !canManage} onClick={() => void deleteColumn()}>{deleting ? 'Deleting…' : 'Delete column'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

export function Progress({ snapshot, dispatch, renderTasks }: { snapshot: Snapshot; dispatch: Dispatch; renderTasks: (items: Item[]) => React.ReactNode; }) {
  const [goals, setGoals] = useState(snapshot.workspace.goals);
  const [failure, setFailure] = useState('');
  const now = new Date();
  const today = localDate(now);
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const completed = snapshot.items.filter(item => item.kind === 'task' && item.done).sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  const counts = new Map<string, number>();
  for (const item of completed) { const day = localDate(new Date(item.completedAt ?? item.updatedAt)); counts.set(day, (counts.get(day) ?? 0) + 1); }
  const paused = (day: string) => snapshot.workspace.goals.vacationPeriods.some(period => day >= period.start && (!period.end || day <= period.end));
  let streak = 0;
  const cursor = new Date(now);
  if ((counts.get(today) ?? 0) < snapshot.workspace.goals.daily && !paused(today)) cursor.setDate(cursor.getDate() - 1);
  const earliest = [...counts.keys(), ...snapshot.workspace.goals.vacationPeriods.map(period => period.start)].sort()[0] ?? today;
  while (localDate(cursor) >= earliest) {
    const day = localDate(cursor);
    if (!paused(day) && (counts.get(day) ?? 0) < snapshot.workspace.goals.daily) break;
    if (!paused(day)) streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  const saveGoals = (next: Workspace['goals']) => {
    const current = snapshot.workspace.goals;
    if (next.daily === current.daily && next.weekly === current.weekly && next.vacation === current.vacation) return;
    if (!Number.isInteger(next.daily) || next.daily < 1 || !Number.isInteger(next.weekly) || next.weekly < 1) {
      setFailure('Goals need a whole number of at least 1.');
      return;
    }
    const periods = [...current.vacationPeriods];
    if (next.vacation && !current.vacation) periods.push({ start: today, end: null });
    if (!next.vacation && current.vacation) {
      const open = periods.map(period => !period.end).lastIndexOf(true);
      if (open >= 0) periods[open] = { ...periods[open]!, end: today };
    }
    setFailure('');
    void dispatch({ type: 'workspace.save', workspace: { ...snapshot.workspace, goals: { ...next, vacationPeriods: periods } } })
      .catch(error => setFailure(errorMessage(error)));
  };
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(day.getDate() + index);
    return { date: localDate(day), title: day.toLocaleDateString(undefined, { weekday: 'short' }) };
  });
  const weekly = days.reduce((sum, day) => sum + (counts.get(day.date) ?? 0), 0);
  return <div className="progress-view">
    <div className="progress-stats">
      <section className="tool-panel">
        <small>Today</small>
        <strong>{counts.get(today) ?? 0}<span> / {snapshot.workspace.goals.daily}</span></strong>
        <progress max={snapshot.workspace.goals.daily} value={counts.get(today) ?? 0} />
      </section>
      <section className="tool-panel">
        <small>This week</small>
        <strong>{weekly}<span> / {snapshot.workspace.goals.weekly}</span></strong>
        <progress max={snapshot.workspace.goals.weekly} value={weekly} />
      </section>
      <section className="tool-panel">
        <small>Daily goal streak</small>
        <strong>{snapshot.workspace.goals.vacation ? 'Paused' : `${streak} days`}</strong>
        <span className="muted">
          {snapshot.workspace.goals.vacation ? 'Goals are paused during vacation.' : 'Consecutive days reaching your daily goal.'}
        </span>
      </section>
    </div>
    <section className="tool-panel">
      <h2>This week</h2>
      <div className="progress-chart">
        {days.map(day => <div key={day.date}>
          <strong>{counts.get(day.date) ?? 0}</strong>
          <div className="chart-track">
            <span
              style={{ height: `${Math.min(100, (counts.get(day.date) ?? 0) / Math.max(snapshot.workspace.goals.daily, ...days.map(day => counts.get(day.date) ?? 0)) * 100)}%` }} />
          </div>
          <small>{day.title}</small>
        </div>)}
      </div>
    </section>
    <form
      className="tool-panel goal-form"
      onSubmit={event => { event.preventDefault(); saveGoals(goals); }}>
      <h2>Goals</h2>
      <p className="muted">Changes save automatically.</p>
      <Label className="field">
        Daily goal
        <Input
          type="number"
          min={1}
          max={1000}
          required
          value={goals.daily}
          onChange={event => setGoals({ ...goals, daily: Number(event.target.value) })}
          onBlur={() => saveGoals(goals)} />
      </Label>
      <Label className="field">
        Weekly goal
        <Input
          type="number"
          min={1}
          max={7000}
          required
          value={goals.weekly}
          onChange={event => setGoals({ ...goals, weekly: Number(event.target.value) })}
          onBlur={() => saveGoals(goals)} />
      </Label>
      <Label className="checkbox-label">
        <Checkbox checked={goals.vacation} onCheckedChange={value => { const next = { ...goals, vacation: value === true }; setGoals(next); saveGoals(next); }} />Vacation mode
      </Label>
      {failure && <p role="alert">{failure}</p>}
    </form>
    <section>
      <div className="group-label"><span>Completed history</span><span>{completed.length} tasks</span></div>
      {completed.length ? renderTasks(completed) : <Empty title="Progress starts with one task">Completed tasks will appear here.</Empty>}
    </section>
  </div>;
}

export function RecentlyDeleted({ snapshot, dispatch }: { snapshot: Snapshot; dispatch: Dispatch; }) {
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  const [confirm, setConfirm] = useState('');
  function run(key: string, command: Parameters<Dispatch>[0]) {
    setBusy(key); setConfirm('');
    void dispatch(command).catch(error => setFailure(errorMessage(error))).finally(() => setBusy(''));
  }
  return <section className="tool-panel">
    <div className="deleted-heading">
      <h2><Trash2 size="1rem" />Recently deleted</h2>
      {snapshot.deletedItems.length > 0 && <Button variant={confirm === 'all' ? 'destructive' : 'outline'} size="sm" disabled={!!busy}
        onClick={() => confirm === 'all' ? run('all', { type: 'item.purge' }) : setConfirm('all')}>
        {confirm === 'all' ? `Delete ${snapshot.deletedItems.length} permanently` : 'Empty'}
      </Button>}
    </div>
    <p className="muted">Restore tasks and notes deleted in the last 30 days. Permanently deleted items can’t be restored.</p>
    {snapshot.deletedItems.length ? snapshot.deletedItems.map(item => <div className="deleted-row" key={item.id}>
      <div><strong>{item.title}</strong><small>{item.kind} · Deleted {new Date(item.deletedAt).toLocaleString()}</small></div>
      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => run(item.id, { type: 'item.restore', id: item.id })}>
        {busy === item.id ? 'Restoring…' : 'Restore'}
      </Button>
      <Button variant="ghost" size="sm" className="danger" disabled={!!busy}
        onClick={() => confirm === item.id ? run(item.id, { type: 'item.purge', id: item.id }) : setConfirm(item.id)}>
        {confirm === item.id ? 'Confirm delete' : 'Delete permanently'}
      </Button>
    </div>) : <Empty title="Nothing recently deleted" />}
    {failure && <p className="note-error" role="alert">{failure}</p>}
  </section>;
}
