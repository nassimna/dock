import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarDays, ChevronDown, FileText, Flag, Folder, ListChecks, MessageSquare, Paperclip, Plus, SlidersHorizontal, Tag, Trash2, X } from 'lucide-react';
import { dateTimeInput, taskPropertiesSchema, type Item, type Snapshot, type TaskProperties } from '@dock/contracts';
import { parseTaskText } from './lib/tasks';
import { ActionButton, LabelPicker, RecognizedTokens } from './components';
import { errorMessage, type Dispatch } from './state';
export function TaskEditor({ item, defaults, snapshot, dispatch, onClose, onDelete, onOpen, panel = false, onDirty, switching = false, onKeep }: {
  item: Item | null;
  defaults: Pick<Item, 'space' | 'scheduledAt' | 'priority'> & { task?: Partial<TaskProperties>; };
  snapshot: Snapshot; dispatch: Dispatch; onClose: () => void; onDelete: (item: Item) => void;
  onOpen?: (item: Item) => void;
  /** Show beside the task list instead of as a dialog. */
  panel?: boolean;
  onDirty?: (dirty: boolean) => void;
  /** Another task is waiting to open; ask before discarding changes. */
  switching?: boolean;
  onKeep?: () => void;
}) {
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [revision, setRevision] = useState(item?.revision);
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [baseScheduled, setScheduled] = useState(dateTimeInput(item?.scheduledAt ?? defaults.scheduledAt));
  const [baseRecurrence, setRecurrence] = useState<Item['recurrence']>(item?.recurrence ?? 'none');
  const [noteId, setNoteId] = useState(item?.linkedNoteId ?? 'none');
  const [baseTask, setTask] = useState(() => item?.task ?? taskPropertiesSchema.parse({ priority: defaults.priority ? 1 : 4, ...defaults.task }));
  const [baseTags, setTags] = useState(item?.tags ?? []);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [reminder, setReminder] = useState('');
  const [childTitle, setChildTitle] = useState('');
  const [comment, setComment] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [manual, setManual] = useState(new Set<string>());
  const savedTitle = useRef(item?.title ?? '');
  const parsed = (() => {
    if (item && title === savedTitle.current) return null;
    try { return parseTaskText(title, snapshot.workspace, new Date(), ignored); } catch { return null; }
  })();
  const projectId = manual.has('projectId') ? baseTask.projectId : parsed?.task.projectId ?? baseTask.projectId;
  const projectChanged = projectId !== baseTask.projectId;
  const task: TaskProperties = {
    ...baseTask,
    priority: manual.has('priority') ? baseTask.priority : parsed?.task.priority ?? baseTask.priority,
    projectId,
    sectionId: projectChanged && !manual.has('sectionId') ? null : baseTask.sectionId,
    parentId: projectChanged ? null : baseTask.parentId,
    assignee: projectChanged && !manual.has('assignee') ? '' : baseTask.assignee,
    durationMinutes: manual.has('durationMinutes') ? baseTask.durationMinutes : parsed?.task.durationMinutes ?? baseTask.durationMinutes,
    repeat: manual.has('repeat') ? baseTask.repeat : parsed?.task.repeat ?? baseTask.repeat,
  };
  const space = item?.space ?? defaults.space;
  const scheduled = manual.has('scheduled') || !parsed?.scheduledAt ? baseScheduled : dateTimeInput(parsed.scheduledAt);
  const recurrence = !manual.has('recurrence') && parsed?.recurrence !== 'none' && parsed?.recurrence ? parsed.recurrence : baseRecurrence;
  const tags = manual.has('tags') ? baseTags : [...new Set([...baseTags, ...(parsed?.tags ?? [])])];
  const deadlineEarly = !!task.deadline && !!scheduled && new Date(task.deadline) < new Date(scheduled);
  const project = snapshot.workspace.projects.find(project => project.id === task.projectId);
  const sharedProject = snapshot.syncFeatures.projects.find(project => project.id === task.projectId);
  const children = snapshot.items.filter(child => child.task.parentId === item?.id && child.kind === 'task');
  const draft = { title, body, scheduled: baseScheduled, recurrence: baseRecurrence, noteId, task: baseTask, tags: baseTags, reminder, childTitle, comment };
  const savedDraft = useRef(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft.current);
  useEffect(() => onDirty?.(dirty), [dirty]);
  function markManual(field: string) { setManual(current => new Set(current).add(field)); }
  function patch(patch: Partial<TaskProperties>) {
    setManual(current => new Set([...current, ...Object.keys(patch)]));
    setTask(current => ({ ...current, ...patch }));
  }
  function loadSaved(saved: Item) {
    const next = { title: saved.title, body: saved.body, scheduled: dateTimeInput(saved.scheduledAt), recurrence: saved.recurrence,
      noteId: saved.linkedNoteId ?? 'none', task: saved.task, tags: saved.tags, reminder: '', childTitle: '', comment: '' };
    setRevision(saved.revision); savedTitle.current = saved.title; setManual(new Set()); savedDraft.current = next;
    setTitle(next.title); setBody(next.body); setIgnored([]); setScheduled(next.scheduled); setRecurrence(next.recurrence);
    setNoteId(next.noteId); setTask(next.task); setTags(next.tags); setReminder(''); setChildTitle(''); setComment('');
  }
  async function persist(close: boolean) {
    const resolved = item && title === savedTitle.current ? null : parseTaskText(title, snapshot.workspace, new Date(), ignored);
    const comments = comment.trim() ? [...task.comments, { id: crypto.randomUUID(), body: comment.trim(), createdAt: new Date().toISOString(), attachments: [] }] : task.comments;
    const reminders = reminder ? [...new Set([...task.reminders, new Date(reminder).toISOString()])] : task.reminders;
    let result = await dispatch({
      type: 'item.save', item: {
        ...(item ? { id: item.id, expectedRevision: revision } : {}),
        kind: 'task', title: resolved?.title ?? title, body, space, priority: task.priority < 4,
        task: { ...task, comments, reminders },
        scheduledAt: scheduled ? new Date(scheduled).toISOString() : null,
        recurrence, linkedNoteId: noteId === 'none' ? null : noteId,
        tags,
      }
    });
    if (item) {
      const parent = result.items.find(saved => saved.id === item.id)!;
      loadSaved(parent);
      if (childTitle.trim()) {
        try {
          result = await dispatch({ type: 'item.save', item: {
            kind: 'task', title: childTitle, space, body: '', priority: false,
            scheduledAt: null, recurrence: 'none', linkedNoteId: null,
            task: taskPropertiesSchema.parse({ projectId: parent.task.projectId, sectionId: parent.task.sectionId, parentId: item.id }),
          } });
        } catch (error) {
          setChildTitle(childTitle);
          throw error;
        }
      }
    }
    if (close) onClose();
    return result;
  }
  async function addSubtask() {
    if (item && childTitle.trim()) await persist(false);
  }
  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure('');
    try { await action(); } catch (error) { setFailure(errorMessage(error)); } finally { setBusy(false); }
  }
  useEffect(() => { if (panel) titleInput.current?.focus(); }, [panel]);
  useEffect(() => {
    if (!panel) return;
    // Menus and dialogs inside the panel handle Escape first and mark it handled.
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) requestClose(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  });
  useEffect(() => {
    const input = titleInput.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${input.scrollHeight}px`; }
  }, [title]);
  const heading = item ? 'Task details' : 'New task';
  const form = <form onSubmit={event => { event.preventDefault(); void run(() => persist(true)); }}>
        <div className="dialog-heading">{panel ? <><h2>{project?.name ?? heading}</h2><ActionButton type="button" aria-label="Close task details" onClick={requestClose}><X size="1rem" /></ActionButton></> : <DialogTitle>{heading}</DialogTitle>}</div>
        <div className="dialog-body" inert={busy}>
          <FileText className="task-page-icon" aria-hidden="true" />
          <Label className="field task-title-field">
            <span className="sr-only">Title</span>
            <Textarea
              ref={titleInput}
              aria-label="Title"
              rows={1}
              onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
              value={title}
              onChange={event => setTitle(event.target.value)}
              required
              maxLength={500}
              placeholder="Review proposal next Tue 9am p2" />
          </Label>
          <RecognizedTokens tokens={parsed?.recognized ?? []} onKeep={token => setIgnored(current => [...current, token.toLowerCase()])} />
          <div className="fields task-primary-fields">
            <div className="field">
              <Label htmlFor="task-project"><Folder size="0.875rem" />Project</Label>
              <Select value={task.projectId ?? 'none'} disabled={!!item && snapshot.syncFeatures.projects.some(project => project.id === item.task.projectId)} onValueChange={value => patch({ projectId: value === 'none' ? null : value, sectionId: null, assignee: '' })}>
                <SelectTrigger id="task-project"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {snapshot.workspace.projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="field">
              <Label htmlFor="task-priority"><Flag size="0.875rem" />Priority</Label>
              <Select value={String(task.priority)} onValueChange={value => patch({ priority: Number(value) as TaskProperties['priority'] })}>
                <SelectTrigger id="task-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map(priority => <SelectItem key={priority} value={String(priority)}>P{priority}{priority === 4 ? ' · Normal' : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Label className="field"><span className="task-property-label"><CalendarDays size="0.875rem" />Schedule</span><DateTimePicker label="Schedule" value={scheduled} onChange={value => { markManual('scheduled'); setScheduled(value); }} /></Label>
            <div className="field">
              <span className="task-property-label"><Tag size="0.875rem" />Labels</span>
              <LabelPicker value={tags} suggestions={[...snapshot.workspace.labels, ...snapshot.items.flatMap(item => item.tags)]}
                onChange={next => { markManual('tags'); setTags(next); }} />
            </div>
          </div>
          <details className="task-properties">
            <summary><SlidersHorizontal size="1rem" /><span>More properties</span><ChevronDown size="0.875rem" /></summary>
            <div className="task-properties-body">
            <div className="fields">
            <div className="field">
              <Label htmlFor="task-section">Section</Label>
              <Select value={task.sectionId ?? 'none'} onValueChange={value => patch({ sectionId: value === 'none' ? null : value })}>
                <SelectTrigger id="task-section"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No section</SelectItem>
                  {project?.sections.map(section => <SelectItem key={section.id} value={section.id}>{section.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Label className="field">
              Deadline
              <DateTimePicker
                label="Deadline"
                value={dateTimeInput(task.deadline)}
                onChange={value => patch({ deadline: value ? new Date(value).toISOString() : null })} />
              {deadlineEarly && <span className="field-warning" role="status">Deadline is before the scheduled date.</span>}
            </Label>
            <Label className="field">
              Duration (minutes)
              <Input
                type="number"
                min={1}
                max={1440}
                required
                value={task.durationMinutes}
                onChange={event => patch({ durationMinutes: Number(event.target.value) })} />
            </Label>
            <div className="field">
              <Label htmlFor="task-recurrence">Repeat</Label>
              <Select value={recurrence} onValueChange={value => { markManual('recurrence'); setRecurrence(value as Item['recurrence']); }}>
                <SelectTrigger id="task-recurrence"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[['none', 'Never'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['weekdays', 'Weekdays'], ['custom', 'Custom interval']].map(([value, label]) => <SelectItem key={value} value={value!}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="field">
              <Label htmlFor="task-note">Linked note</Label>
              <Select value={noteId} onValueChange={setNoteId}>
                <SelectTrigger id="task-note"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {snapshot.items.filter(note => note.kind === 'note').map(note => <SelectItem key={note.id} value={note.id}>{note.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            </div>
          {recurrence === 'custom' && <div className="repeat-options">
            <Label>
              Every
              <Input
                aria-label="Repeat interval"
                type="number"
                min={1}
                max={365}
                value={task.repeat.interval}
                onChange={event => patch({ repeat: { ...task.repeat, interval: Number(event.target.value) } })} />
            </Label>
            <Select value={task.repeat.unit} onValueChange={unit => patch({ repeat: { ...task.repeat, unit: unit as 'day' | 'week' | 'month' } })}>
              <SelectTrigger aria-label="Repeat unit"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['day', 'week', 'month'].map(unit => <SelectItem key={unit} value={unit}>{unit}(s)</SelectItem>)}
              </SelectContent>
            </Select>
            <Label className="checkbox-label">
              <Checkbox
                checked={task.repeat.afterCompletion}
                onCheckedChange={value => patch({ repeat: { ...task.repeat, afterCompletion: value === true } })} /> After completion
            </Label>
          </div>}
          <Label className="field">
            Assignee
            {sharedProject ? <Select value={task.assignee || "none"} onValueChange={value => patch({ assignee: value === "none" ? "" : value })}>
              <SelectTrigger aria-label="Assignee"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {sharedProject.members.map(member => <SelectItem key={member.email} value={member.email}>{member.email}</SelectItem>)}
              </SelectContent>
            </Select> : <Input
              aria-label="Assignee email"
              type="email"
              value={task.assignee}
              onChange={event => patch({ assignee: event.target.value })}
              placeholder="Email address" />}
          </Label>
          <section className="detail-section" aria-label="Reminders">
            <h3><Bell size="0.9375rem" />Reminders</h3>
            <p className="muted">The scheduled time also sends a reminder. Add up to 20 extra times.</p>
            {task.reminders.map(value => <div className="detail-line" key={value}>
              <span>{new Date(value).toLocaleString()}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove reminder ${value}`}
                onClick={() => patch({ reminders: task.reminders.filter(time => time !== value) })}>
                <Trash2 size="0.875rem" />
              </Button>
            </div>)}
            <div className="detail-line">
              <DateTimePicker label="Additional reminder" value={reminder} onChange={setReminder} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!reminder || task.reminders.length >= 20}
                onClick={() => { patch({ reminders: [...new Set([...task.reminders, new Date(reminder).toISOString()])] }); setReminder(''); }}>Add reminder</Button>
            </div>
          </section>
            </div>
          </details>
          <Label className="field task-page-notes">
            Notes
            <Textarea value={body} onChange={event => setBody(event.target.value)} rows={2} maxLength={200000} placeholder="Add context…" />
          </Label>
          {item && <section className="detail-section" aria-label="Subtasks">
            <h3><ListChecks size="1rem" />Subtasks <small>{children.filter(child => child.done).length}/{children.length}</small></h3>
            {children.map(child => <div className="detail-line" key={child.id}>
              <Checkbox
                checked={child.done}
                aria-label={`${child.done ? 'Reopen' : 'Complete'} ${child.title}`}
                onCheckedChange={() => void run(() => dispatch({ type: 'item.toggle', id: child.id }))} />
              <Button type="button" variant="ghost" className={child.done ? 'line-through' : ''} disabled={busy} onClick={() => void run(async () => { const result = await persist(false); onOpen?.(result.items.find(saved => saved.id === child.id)!); })}>
                {child.title}
              </Button>
            </div>)}
            <div className="detail-line">
              <Input
                aria-label="New subtask"
                placeholder="Add a subtask…"
                value={childTitle}
                onChange={event => setChildTitle(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy) void run(addSubtask); } }} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!childTitle.trim() || busy}
                onClick={() => void run(addSubtask)}>
                <Plus size="0.875rem" />Add
              </Button>
            </div>
          </section>}
          <section className="detail-section" aria-label="Comments">
            <h3><MessageSquare size="1rem" />Comments <small>{task.comments.length}</small></h3>
            {task.comments.map(comment => <article className="task-comment" key={comment.id}>
              <small>{new Date(comment.createdAt).toLocaleString()}</small>
              <p>{comment.body}</p>
              {comment.attachments.map(file => <Button
                type="button"
                variant="outline"
                size="sm"
                key={file.id}
                onClick={() => void run(() => dispatch({ type: 'attachment.open', id: file.id }))}>
                <Paperclip size="0.875rem" />
                {file.name}
              </Button>)}
            </article>)}
            <div className="detail-line">
              <Textarea
                aria-label="New comment"
                rows={2}
                value={comment}
                onChange={event => setComment(event.target.value)}
                placeholder="Leave a comment…"
                maxLength={20000} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!comment.trim()}
                onClick={() => {
                  patch({ comments: [...task.comments, { id: crypto.randomUUID(), body: comment.trim(), createdAt: new Date().toISOString(), attachments: [] }] });
                  setComment('');
                }}>Add comment</Button>
            </div>
            {item && <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(async () => {
                await persist(false);
                const result = await dispatch({ type: 'attachment.add', itemId: item.id });
                const saved = result.items.find(saved => saved.id === item.id)!;
                loadSaved(saved);
              })}>
              <Paperclip size="0.875rem" />Attach local file
            </Button>}
            <p className="muted">Comments save with the task. File copies stay on this computer.</p>
          </section>
          {failure && <p className="note-error" role="alert">{failure}</p>}
        </div>
        <div className="dialog-footer">
          {item ? <Button variant="ghost" type="button" className="danger" disabled={busy} onClick={() => onDelete(item)}>Delete task</Button> : <span />}
          <div className="task-page-actions"><Button variant="ghost" type="button" disabled={busy} onClick={requestClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save task'}</Button></div>
        </div>
      </form>;
  return <>
  {panel ? <aside className="task-panel" aria-label={heading}>{form}</aside> : <Dialog open onOpenChange={open => { if (!open) requestClose(); }}>
    <DialogContent
      className="editor-dialog task-detail-dialog"
      aria-describedby={undefined}
      onOpenAutoFocus={event => { event.preventDefault(); titleInput.current?.focus(); }}>
      {form}
    </DialogContent>
  </Dialog>}
  <Dialog open={confirmClose || switching} onOpenChange={open => { if (!open) { setConfirmClose(false); onKeep?.(); } }}>
    <DialogContent className="task-close-confirm" aria-describedby="task-close-description">
      <DialogTitle>Unsaved task changes</DialogTitle>
      <p id="task-close-description">Save your changes before {switching ? 'opening another task' : 'closing this task'}?</p>
      {failure && <p className="note-error" role="alert">{failure}</p>}
      <div className="dialog-footer">
        <Button variant="ghost" disabled={busy} onClick={() => { setConfirmClose(false); onKeep?.(); }}>Keep editing</Button>
        <Button variant="outline" disabled={busy} onClick={onClose}>Discard changes</Button>
        <Button disabled={busy} onClick={() => void run(() => persist(true))}>{busy ? 'Saving…' : switching ? 'Save and continue' : 'Save and close'}</Button>
      </div>
    </DialogContent>
  </Dialog>
  </>;
}
