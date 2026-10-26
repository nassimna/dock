import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeftRight, Check, FileText, Inbox, Link2, List, MoreHorizontal, Plus, Save, Tag, Trash2, Type, X } from "lucide-react";
import type { Item, Snapshot } from "@dock/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NoteEditor } from "./NoteEditor";
import { ActionButton, Empty } from "./components";
import { errorMessage, type Dispatch } from "./state";
import { noteFontFamilies } from "@/lib/theme";

type Draft = Pick<Item, "title" | "body" | "space" | "tags" | "noteStyle"> & {
  status: "saved" | "saving" | "error";
  error: string;
  generation: number;
};
function initialDraft(note: Item): Draft {
  return { title: note.title, body: note.body, space: note.space, tags: note.tags,
    noteStyle: note.noteStyle, status: "saved", error: "", generation: 0 };
}

export function Notes({ snapshot, query, dispatch, onTask, onDelete }: {
  snapshot: Snapshot; query: string; dispatch: Dispatch;
  onTask: (item: Item) => void; onDelete: (item: Item) => void;
}) {
  const notes = snapshot.items.filter(item => item.kind === "note");
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftRef = useRef<Record<string, Draft>>({});
  const queues = useRef(new Map<string, Promise<unknown>>());
  const pending = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const revisions = useRef(new Map<string, number>());
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => window.dock.onBeforeUpdate(async () => {
    await Promise.all(notes.map(flush));
    if (notes.some(note => draftRef.current[note.id] && draftRef.current[note.id]!.status !== "saved"))
      throw new Error("Save your notes or resolve their save errors before restarting Dock.");
  }, true), [snapshot.items]);
  useEffect(() => () => {
    for (const note of notesRef.current) void flush(note);
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [tagQuery, setTagQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [taskError, setTaskError] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const visible = notes.filter(note => {
    const draft = drafts[note.id] ?? initialDraft(note);
    return `${draft.title} ${draft.body} ${draft.tags.join(" ")}`.toLowerCase().includes((filter || query).toLowerCase());
  });
  const note = notes.find(note => note.id === selected) ?? visible[0];
  const draft = note ? drafts[note.id] ?? initialDraft(note) : null;

  useEffect(() => { if (note && !selected) setSelected(note.id); }, [note?.id, selected]);

  function put(id: string, draft: Draft) {
    draftRef.current = { ...draftRef.current, [id]: draft };
    setDrafts(draftRef.current);
  }
  useEffect(() => {
    const next = { ...draftRef.current };
    let changed = false;
    for (const note of notes) {
      if (!pending.current.get(note.id) &&
          (!next[note.id] || next[note.id]?.status === "saved") && revisions.current.get(note.id) !== note.revision) {
        revisions.current.set(note.id, note.revision);
        next[note.id] = initialDraft(note);
        changed = true;
      }
    }
    if (changed) { draftRef.current = next; setDrafts(next); }
  }, [snapshot.items]);

  function save(item: Item, content: Draft): Promise<unknown> {
    clearTimeout(timers.current.get(item.id));
    timers.current.delete(item.id);
    if (content.status === "saved")
      return queues.current.get(item.id) ?? Promise.resolve();
    if (pending.current.get(item.id)) return queues.current.get(item.id)!.then(() => {
      const latest = draftRef.current[item.id];
      if (latest?.status === "saving") return save(item, latest);
    });
    if (!content.title.trim()) {
      put(item.id, { ...content, status: "error", error: "Give the note a title to save it." });
      return Promise.resolve();
    }
    pending.current.set(item.id, (pending.current.get(item.id) ?? 0) + 1);
    put(item.id, { ...content, status: "saving", error: "" });
    const queue = (queues.current.get(item.id) ?? Promise.resolve()).then(async () => {
      try {
        const result = await dispatch({ type: "item.save", item: {
          id: item.id, expectedRevision: revisions.current.get(item.id) ?? item.revision,
          kind: "note", title: content.title, body: content.body, space: content.space,
          tags: content.tags, noteStyle: content.noteStyle,
          priority: item.priority, scheduledAt: null, recurrence: "none", linkedNoteId: null,
        } });
        revisions.current.set(item.id, result.items.find(note => note.id === item.id)!.revision);
        const current = draftRef.current[item.id]!;
        if (current.generation === content.generation)
          put(item.id, { ...current, status: "saved", error: "" });
      } catch (error) {
        const current = draftRef.current[item.id]!;
        if (current.generation === content.generation)
          put(item.id, { ...current, status: "error", error: errorMessage(error) });
      } finally {
        pending.current.set(item.id, (pending.current.get(item.id) ?? 1) - 1);
      }
    });
    queues.current.set(item.id, queue);
    return queue;
  }
  async function flush(item: Item): Promise<void> {
    const content = draftRef.current[item.id];
    if (content?.status === "saving") await save(item, content);
    else await queues.current.get(item.id);
    if (draftRef.current[item.id]?.status === "saving") await flush(item);
  }
  function edit(update: Partial<Draft>) {
    if (!note || !draft) return;
    const current = draftRef.current[note.id] ?? draft;
    const next: Draft = { ...current, ...update, status: "saving", error: "", generation: current.generation + 1 };
    put(note.id, next);
    clearTimeout(timers.current.get(note.id));
    timers.current.set(note.id, setTimeout(() => void save(note, draftRef.current[note.id]!), 300));
  }
  function choose(id: string) {
    if (note && note.id !== id) void flush(note);
    setSelected(id); setFilter(""); setLibraryOpen(false); setTaskError("");
  }
  useEffect(() => {
    const handleSave = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" &&
          document.querySelector(".notes-workspace")?.closest("[hidden]") === null && note && draft) {
        event.preventDefault(); save(note, draftRef.current[note.id] ?? draft);
      }
    };
    window.addEventListener("keydown", handleSave);
    return () => window.removeEventListener("keydown", handleSave);
  });
  async function create() {
    const existing = new Set(notes.map(note => note.id));
    try {
      if (note) await flush(note);
      const result = await dispatch({ type: "item.save", item: {
        kind: "note", title: "Untitled note", body: "", space: "Inbox", priority: false,
        scheduledAt: null, recurrence: "none", linkedNoteId: null,
      } });
      setSelected(result.items.find(item => item.kind === "note" && !existing.has(item.id))!.id);
      setFilter(""); setLibraryOpen(false);
    } catch { /* The shared banner reports the failure. */ }
  }
  async function linkTask(task: Item, linked: boolean) {
    setLinking(task.id); setTaskError("");
    try {
      await dispatch({ type: "item.save", item: { ...task, expectedRevision: task.revision, linkedNoteId: linked ? note!.id : null } });
    } catch (error) { setTaskError(errorMessage(error)); }
    finally { setLinking(null); }
  }
  const linkedTasks = snapshot.items.filter(item => item.kind === "task" && item.linkedNoteId === note?.id);
  const allTags = [...new Set(snapshot.items.flatMap(item => item.tags).concat(draft?.tags ?? []))].sort();
  const matches = allTags.filter(tag => tag.toLowerCase().includes(tagQuery.toLowerCase()));
  function toggleTag(tag: string) {
    if (!draft || (!draft.tags.includes(tag) && draft.tags.length >= 30)) return;
    edit({ tags: draft.tags.includes(tag) ? draft.tags.filter(value => value !== tag) : [...draft.tags, tag] });
  }
  const library = <>
    <Input size="xs" aria-label="Search notes" placeholder="Search notes…" value={filter} onChange={event => setFilter(event.target.value)} />
    <div className="note-library-list">
      {visible.map(item => <Button key={item.id} variant="ghost" className="note-library-row"
        aria-label={`Open note: ${drafts[item.id]?.title || item.title}`} aria-current={note?.id === item.id ? "page" : undefined}
        onClick={() => choose(item.id)}>
        <FileText size="0.875rem" /><span><strong>{drafts[item.id]?.title || item.title}</strong><small>{drafts[item.id]?.space ?? item.space}</small></span>
      </Button>)}
      {!visible.length && <p className="muted">No matching notes.</p>}
    </div>
  </>;
  const font = draft?.noteStyle.font;
  const style = {
    ...(font ? { "--note-font": noteFontFamilies[font] } : {}),
    ...(draft?.noteStyle.size ? { "--note-font-size": `${draft.noteStyle.size / 16}rem` } : {}),
  } as CSSProperties;
  return <section className="notes-workspace">
    <div className="notes-heading">
      <div className="notes-breadcrumb">
        <Popover open={libraryOpen} onOpenChange={setLibraryOpen}>
          <PopoverTrigger asChild><Button variant="ghost" size="xs" className="notes-library-toggle" aria-label="Open note library"><List size="1rem" /></Button></PopoverTrigger>
          <PopoverContent align="start" className="notes-library-popover">{library}</PopoverContent>
        </Popover>
        <h1>Notes</h1><span className="notes-count">{notes.length}</span>
      </div>
      <div className="notes-heading-actions">
        {note && draft && <div className="note-page-actions">
          <span className="note-save-state" role="status" aria-live="polite">{draft.status === "saving" ? "Saving…" : draft.status === "error" ? "Not saved" : snapshot.system.platform === "darwin" ? "Saved on this Mac" : "Saved on this device"}</span>
          <Button size="xs" onClick={() => save(note, draftRef.current[note.id] ?? draft)}><Save size="0.875rem" /> Save</Button>
          <ActionButton size="xs" className="note-width-toggle" aria-label={draft.noteStyle.fullWidth ? "Use page width" : "Use full width"}
            aria-pressed={draft.noteStyle.fullWidth ?? false} onClick={() => edit({ noteStyle: { ...draft.noteStyle, fullWidth: !draft.noteStyle.fullWidth } })}>
            <ArrowLeftRight size="1rem" /><span>Full width</span>
          </ActionButton>
          <Popover>
            <PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Note appearance"><Type size="1rem" /></Button></PopoverTrigger>
            <PopoverContent align="end" className="note-appearance">
              <Label htmlFor="note-font">Font</Label><Select value={draft.noteStyle.font ?? "inherit"} onValueChange={value => edit({ noteStyle: { ...draft.noteStyle, font: value === "inherit" ? undefined : value as NonNullable<Item["noteStyle"]["font"]> } })}>
                <SelectTrigger id="note-font" aria-label="Note font"><SelectValue /></SelectTrigger><SelectContent>{[["inherit", "Use preference"], ["system", "Default"], ["serif", "Serif"], ["mono", "Mono"]].map(([value, label]) => <SelectItem key={value} value={value!}>{label}</SelectItem>)}</SelectContent>
              </Select>
              <Label htmlFor="note-text-size">Text size</Label><Select value={String(draft.noteStyle.size ?? "inherit")} onValueChange={value => edit({ noteStyle: { ...draft.noteStyle, size: value === "inherit" ? undefined : Number(value) as 14 | 16 | 18 } })}>
                <SelectTrigger id="note-text-size" aria-label="Note text size"><SelectValue /></SelectTrigger><SelectContent>{[["inherit", "Use preference"], ["14", "Small"], ["16", "Default"], ["18", "Large"]].map(([value, label]) => <SelectItem key={value} value={value!}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="More note actions"><MoreHorizontal size="1rem" /></Button></PopoverTrigger>
            <PopoverContent align="end" className="note-action-menu"><Button variant="ghost" className="danger" onClick={() => void flush(note).then(() => onDelete(note))}><Trash2 size="0.875rem" /> Delete note</Button></PopoverContent>
          </Popover>
        </div>}
        <Button variant="outline" size="xs" onClick={() => void create()}><Plus size="0.9375rem" /> New note</Button>
      </div>
    </div>
    <div className="notes-layout">
      {!!notes.length && <aside className="notes-library" aria-label="Note library">{library}</aside>}
      {!note ? <Empty title={filter || query ? "No matching notes" : "Keep a thought here"}>
        {filter || query ? "Try another search." : "Create a note or capture one from anywhere."}
      </Empty> : note && draft && <div className={`note-editor ${draft.noteStyle.fullWidth ? "note-full-width" : ""}`} style={style}>
        <Input className="note-title" aria-label="Note title" value={draft.title} maxLength={500} onChange={event => edit({ title: event.target.value })} />
        <div className="note-properties">
          <div className="note-property"><span className="note-property-label"><Inbox size="1rem" aria-hidden="true" />Space</span>
            <div className="note-property-values">
              <Select value={draft.space} onValueChange={space => edit({ space: space as Item["space"] })}>
                <SelectTrigger aria-label="Note space" size="xs"><SelectValue /></SelectTrigger>
                <SelectContent position="popper">{["Inbox", "Work", "Personal"].map(space => <SelectItem key={space} value={space}>{space}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="note-property"><span className="note-property-label"><Tag size="1rem" aria-hidden="true" />Tags</span>
            <div className="note-property-values">
              {draft.tags.map(tag => <Button key={tag} variant="secondary" size="xs" className="note-tag-chip" aria-label={`Remove tag ${tag}`} onClick={() => toggleTag(tag)}><span>{tag}</span><X size="0.75rem" aria-hidden="true" /></Button>)}
              <Popover onOpenChange={open => { if (open) setTagQuery(""); }}>
                <PopoverTrigger asChild><Button variant="ghost" size="xs" className="note-property-add" aria-label="Edit note tags"><Plus size="0.875rem" aria-hidden="true" />Add tags</Button></PopoverTrigger>
                <PopoverContent align="start" className="note-picker">
                  <Input size="xs" aria-label="Search or create tag" placeholder="Search or create tag…" maxLength={40} value={tagQuery} onChange={event => setTagQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && tagQuery.trim()) { event.preventDefault(); toggleTag(tagQuery.trim()); setTagQuery(""); } }} />
                  <div className="note-picker-options">{matches.map(tag => <Button variant="ghost" size="xs" key={tag} onClick={() => toggleTag(tag)} disabled={!draft.tags.includes(tag) && draft.tags.length >= 30}><Check size="0.875rem" className={draft.tags.includes(tag) ? "" : "invisible"} />{tag}</Button>)}</div>
                  {tagQuery.trim() && !allTags.includes(tagQuery.trim()) && <Button variant="ghost" onClick={() => { toggleTag(tagQuery.trim()); setTagQuery(""); }} disabled={draft.tags.length >= 30}><Plus size="0.875rem" /> Create “{tagQuery.trim()}”</Button>}
                  {!matches.length && !tagQuery.trim() && <p className="muted">Type a name to create your first tag.</p>}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="note-property"><span className="note-property-label"><Link2 size="1rem" aria-hidden="true" />Linked tasks</span>
            <div className="note-property-values">
              {linkedTasks.map(task => <div className="note-task-chip" key={task.id}>
                <Button variant="ghost" size="xs" onClick={() => onTask(task)}><Link2 size="0.875rem" aria-hidden="true" /><span>{task.title}</span></Button>
                <Button variant="ghost" size="icon-xs" aria-label={`Unlink ${task.title}`} disabled={linking !== null} onClick={() => void linkTask(task, false)}><X size="0.75rem" aria-hidden="true" /></Button>
              </div>)}
              <Popover onOpenChange={open => { if (open) { setTaskQuery(""); setTaskError(""); } }}>
                <PopoverTrigger asChild><Button variant="ghost" size="xs" className="note-property-add" aria-label="Edit linked tasks"><Plus size="0.875rem" aria-hidden="true" />Link task</Button></PopoverTrigger>
                <PopoverContent align="start" className="note-picker">
                  <Input size="xs" aria-label="Search tasks to link" placeholder="Search tasks…" value={taskQuery} onChange={event => setTaskQuery(event.target.value)} />
                  <div className="note-picker-options">{snapshot.items.filter(item => item.kind === "task" && item.title.toLowerCase().includes(taskQuery.toLowerCase())).map(task => <Button key={task.id} variant="ghost" disabled={linking !== null} onClick={() => void linkTask(task, task.linkedNoteId !== note.id)}>
                    <Check size="0.875rem" className={task.linkedNoteId === note.id ? "" : "invisible"} /><span>{task.title}<small>{task.linkedNoteId && task.linkedNoteId !== note.id ? "Moves link from another note" : task.space}</small></span>
                  </Button>)}</div>
                  {!snapshot.items.some(item => item.kind === "task" && item.title.toLowerCase().includes(taskQuery.toLowerCase())) && <p className="muted">No matching tasks. Create a task first.</p>}
                  {taskError && <p role="alert" className="note-error">{taskError}</p>}
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
        {draft.status === "error" && <div className="note-error" role="alert"><p>{draft.error}</p><div>
          <Button variant="outline" size="xs" onClick={() => { revisions.current.set(note.id, note.revision); save(note, draft); }}>Retry save</Button>
          <Button variant="outline" size="xs" onClick={() => { revisions.current.set(note.id, note.revision); put(note.id, initialDraft(note)); }}>Use saved version</Button>
        </div><small>Your draft stays here until you replace it.</small></div>}
        <NoteEditor key={note.id} value={draft.body} onChange={body => edit({ body })} notes={notes} onOpenNote={choose}>
          <span className="note-sync-state">{!snapshot.sync.connected ? "Local only" : snapshot.sync.phase === "synced" && draft.status === "saved" ? "Synced" : snapshot.sync.phase === "offline" ? "Offline · sync pending" : snapshot.sync.phase === "error" ? "Sync needs attention" : "Sync pending"}</span>
        </NoteEditor>
      </div>}
    </div>
  </section>;
}
