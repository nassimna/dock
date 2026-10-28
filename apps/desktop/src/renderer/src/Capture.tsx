import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, FileText, ListTodo, Plus, SlidersHorizontal } from "lucide-react";
import { dateTimeInput, taskPropertiesSchema, type Item, type Snapshot, type TaskProperties } from "@dock/contracts";
import { parseTaskText } from "./lib/tasks";
import { RecognizedTokens, Shortcut } from "./components";
import type { Act, Dispatch } from "./state";

export function Capture({ dispatch, act, snapshot }: { dispatch: Dispatch; snapshot: Snapshot; act: Act }) {
  const [kind, setKind] = useState<Item["kind"]>("task");
  const [text, setText] = useState("");
  const [baseSpace, setSpace] = useState<Item["space"]>("Inbox");
  const [basePriority, setPriority] = useState<TaskProperties['priority']>(4);
  const [baseProjectId, setProjectId] = useState<string | null>(null);
  const [baseScheduled, setScheduled] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [failure, setFailure] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(new Set<string>());
  const [ignored, setIgnored] = useState<string[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const parsed = (() => {
    if (kind !== 'task') return null;
    try { return parseTaskText(text.split('\n')[0]!, snapshot.workspace, new Date(), ignored); } catch { return null; }
  })();
  const space = kind === 'task' ? 'Inbox' : baseSpace;
  const priority = manual.has('priority') ? basePriority : parsed?.task.priority ?? basePriority;
  const projectId = kind === 'task' ? (manual.has('projectId') ? baseProjectId : parsed?.task.projectId ?? baseProjectId) : null;
  const scheduled = manual.has('scheduled') || !parsed?.scheduledAt ? baseScheduled : dateTimeInput(parsed.scheduledAt);
  const destination = snapshot.workspace.projects.find(project => project.id === projectId)?.name ?? space;
  const optionSummary = kind === 'task' ? snapshot.workspace.projects.find(project => project.id === projectId)?.name : space !== 'Inbox' && space;
  useEffect(() => window.dock.onBeforeUpdate(async () => {
    if (text.trim()) throw new Error("Save or clear your quick capture draft before restarting Rivnote.");
  }), [text]);
  useEffect(() => window.dock.onCapture(() => input.current?.focus()), []);
  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy]);
  useEffect(() => {
    const shell = input.current!.closest(".app-shell")!;
    const resize = new ResizeObserver(() => {
      const height = Math.min(600, Math.max(180, Math.ceil(shell.getBoundingClientRect().height)));
      void window.dock.dispatch({ type: "capture.resize", height }).catch(console.error);
    });
    resize.observe(shell);
    return () => resize.disconnect();
  }, []);
  function markManual(field: string) { setManual(current => new Set(current).add(field)); }
  async function save(keepOpen = false) {
    if (!text.trim() || busy) return;
    const [first, ...rest] = text.trim().split("\n");
    setBusy(true); setFailure(""); setSavedMessage("");
    try {
      const parsed = kind === 'task' ? parseTaskText(first!, snapshot.workspace, new Date(), ignored) : null;
      await dispatch({ type: "item.save", item: {
        kind, title: parsed?.title ?? first!, body: rest.join("\n"), space,
        task: kind === 'task' ? taskPropertiesSchema.parse({ ...parsed?.task, priority, projectId }) : undefined,
        tags: parsed?.tags, priority: kind === 'task' && priority < 4,
        scheduledAt: kind === 'task' && scheduled ? new Date(scheduled).toISOString() : null,
        recurrence: parsed?.recurrence ?? "none", linkedNoteId: null,
      } });
      setSavedMessage(`${kind === 'task' ? 'Task' : 'Note'} saved to ${destination}.`);
      setText(""); setPriority(4); setScheduled("");
      setShowSchedule(false); setManual(new Set()); setIgnored([]);
      if (!keepOpen) {
        setShowOptions(false);
        await window.dock.setCaptureVisible(false);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not capture the item.');
    } finally {
      setBusy(false);
    }
  }
  return <form className="capture" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="capture-modes">
      <Button size="xs" variant="ghost" type="button" disabled={busy} aria-pressed={kind === "task"} onClick={() => { setKind("task"); input.current?.focus(); }}>
        <ListTodo size="0.9375rem" /> Task
      </Button>
      <Button size="xs" variant="ghost" type="button" disabled={busy} aria-pressed={kind === "note"} onClick={() => { setKind("note"); input.current?.focus(); }}>
        <FileText size="0.9375rem" /> Note
      </Button>
    </div>
    <Textarea ref={input} className="capture-text" rows={3} aria-label="Capture text"
      placeholder={kind === "task" ? "Add a task…" : "Write a note…"}
      value={text} maxLength={200000} disabled={busy}
      onChange={event => { setText(event.target.value); setSavedMessage(''); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault(); void save(event.metaKey || event.ctrlKey);
        }
      }} />
    {kind === 'task' && !!parsed?.recognized.length && <p className="capture-hint">
      {destination} · P{priority}{scheduled && ` · ${new Date(scheduled).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
      {!!parsed.tags.length && ` · ${parsed.tags.map(tag => `@${tag}`).join(' ')}`}
    </p>}
    {kind === 'task' && <RecognizedTokens tokens={parsed?.recognized ?? []} onKeep={token => setIgnored(current => [...current, token.toLowerCase()])} />}
    {savedMessage && <p className="capture-saved" role="status">{savedMessage}</p>}
    {failure && <p role="alert" className="note-error">{failure}</p>}
    {showOptions && <div id="capture-details" className="capture-details" inert={busy}>
      <div className="capture-options">
        {kind === 'task' && <>
          <Select value={String(priority)} disabled={busy} onValueChange={value => { markManual('priority'); setPriority(Number(value) as TaskProperties['priority']); }}>
            <SelectTrigger aria-label="Capture priority" size="xs"><SelectValue /></SelectTrigger>
            <SelectContent position="popper">{[1, 2, 3, 4].map(priority => <SelectItem key={priority} value={String(priority)}>P{priority}{priority === 4 ? ' · Normal' : ''}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={projectId ?? 'none'} disabled={busy} onValueChange={value => { markManual('projectId'); setProjectId(value === 'none' ? null : value); }}>
            <SelectTrigger aria-label="Capture project" size="xs"><SelectValue /></SelectTrigger>
            <SelectContent position="popper"><SelectItem value="none">No project</SelectItem>{snapshot.workspace.projects.map(project => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="xs" variant="ghost" type="button" disabled={busy} className={showSchedule || scheduled ? 'active' : ''} aria-expanded={showSchedule} onClick={() => setShowSchedule(!showSchedule)}>
            <CalendarDays size="0.9375rem" /> Schedule
          </Button>
        </>}
        {kind === 'note' && <Select value={space} disabled={busy} onValueChange={value => setSpace(value as Item['space'])}>
          <SelectTrigger aria-label="Capture space" size="xs"><SelectValue /></SelectTrigger>
          <SelectContent position="popper"><SelectItem value="Inbox">Inbox</SelectItem><SelectItem value="Work">Work</SelectItem><SelectItem value="Personal">Personal</SelectItem></SelectContent>
        </Select>}
      </div>
      {showSchedule && kind === 'task' && <Label className="field schedule-field">
        Remind me at
        <DateTimePicker label="Capture schedule" value={scheduled} onChange={value => { markManual('scheduled'); setScheduled(value); }} />
      </Label>}
      <Button size="xs" variant="ghost" type="button" className="capture-main" onClick={() => act({ type: "window", action: "main" })}>Open {snapshot.system.name}</Button>
    </div>}
    <div className="capture-footer">
      <Button size="sm" variant="ghost" type="button" className={showOptions || priority < 4 || scheduled || optionSummary ? 'active' : ''}
        disabled={busy} aria-expanded={showOptions} aria-controls="capture-details" onClick={() => setShowOptions(!showOptions)}>
        <SlidersHorizontal size="0.875rem" /> Options{optionSummary && <span>· {optionSummary}</span>}
      </Button>
      <div className="capture-actions">
        <Button size="sm" variant="outline" type="button" disabled={!text.trim() || busy} onClick={() => void save(true)} aria-keyshortcuts="Meta+Enter Control+Enter">Save and add another</Button>
        <Button size="sm" variant="default" disabled={!text.trim() || busy}><Plus size="0.9375rem" />{busy ? 'Saving…' : 'Capture'}</Button>
      </div>
    </div>
    <span className="capture-shortcut"><Shortcut value="CommandOrControl+Enter" /> saves and keeps capture open</span>
  </form>;
}
