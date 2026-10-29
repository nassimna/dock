import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Hash, Plus, Search, Star, X } from 'lucide-react';
import { type Item, type Project, type Snapshot } from '@dock/contracts';
import { compileFilter } from './lib/tasks';
import { errorMessage, type Dispatch } from './state';
import { Empty } from './components';
export function ProjectEditor({ project, snapshot, dispatch, onClose, onSaved }: { project: Project | null; snapshot: Snapshot; dispatch: Dispatch; onClose: () => void; onSaved: (id: string) => void; }) {
  const [draft, setDraft] = useState<Project>(() => project ?? { id: crypto.randomUUID(), name: '', parentId: null, color: '#8b70ef', favorite: false, sections: [] });
  const [section, setSection] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const descendants = new Set([draft.id]);
  for (let i = 0; i < snapshot.workspace.projects.length; i++) for (const item of snapshot.workspace.projects) if (item.parentId && descendants.has(item.parentId)) descendants.add(item.id);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent aria-describedby={undefined} className="workspace-dialog">
      <DialogTitle>{project ? 'Edit project' : 'New project'}</DialogTitle>
      <form
        className="workspace-form"
        onSubmit={event => {
          event.preventDefault();
          setBusy(true);
          void dispatch({ type: 'workspace.save', workspace: { ...snapshot.workspace, projects: project ? snapshot.workspace.projects.map(item => item.id === draft.id ? draft : item) : [...snapshot.workspace.projects, draft] } }).then(async () => {
            if (snapshot.syncFeatures.projects.some(item => item.id === draft.id && item.ownerEmail === snapshot.sync.email)) await dispatch({ type: 'sync.project.share', project: draft });
            onSaved(draft.id);
            onClose();
          }).catch(error => { setFailure(errorMessage(error)); setBusy(false); });
        }}>
        <Label className="field">
          Project name
          <Input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required maxLength={100} autoFocus />
        </Label>
        <Label className="field">
          Parent project
          <Select value={draft.parentId ?? 'none'} onValueChange={value => setDraft({ ...draft, parentId: value === 'none' ? null : value })}>
            <SelectTrigger aria-label="Parent project"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Top level</SelectItem>
              {snapshot.workspace.projects.filter(item => !descendants.has(item.id)).map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </Label>
        <div className="detail-line">
          <Label className="field">
            Color
            <Input type="color" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value })} />
          </Label>
          <Label className="checkbox-label">
            <Checkbox checked={draft.favorite} onCheckedChange={value => setDraft({ ...draft, favorite: value === true })} />Favorite
          </Label>
        </div>
        <h3>Sections</h3>
        {draft.sections.map((item, index) => <Input
          key={item.id}
          aria-label={`Section ${index + 1}`}
          value={item.name}
          required
          maxLength={100}
          onChange={event => setDraft({ ...draft, sections: draft.sections.map(section => section.id === item.id ? { ...section, name: event.target.value } : section) })} />)}
        <div className="detail-line">
          <Input
            aria-label="New section"
            placeholder="Add a section…"
            value={section}
            maxLength={100}
            onChange={event => setSection(event.target.value)} />
          <Button
            type="button"
            variant="outline"
            disabled={!section.trim()}
            onClick={() => { setDraft({ ...draft, sections: [...draft.sections, { id: crypto.randomUUID(), name: section.trim() }] }); setSection(''); }}>
            <Plus size="0.9375rem" />Add
          </Button>
        </div>
        {failure && <p role="alert" className="note-error">{failure}</p>}
        <Button disabled={busy}>{busy ? 'Saving…' : 'Save project'}</Button>
      </form>
    </DialogContent>
  </Dialog>;
}

export function Filters({ snapshot, dispatch, renderTasks, onFilter }: { snapshot: Snapshot; dispatch: Dispatch; renderTasks: (items: Item[]) => React.ReactNode; onFilter: (id: string) => void; }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('(today | overdue) & p1');
  const [favorite, setFavorite] = useState(true);
  const [label, setLabel] = useState('');
  const [failure, setFailure] = useState('');
  let matches: Item[] = [], syntaxError = '';
  try {
    const test = compileFilter(query, snapshot.workspace);
    matches = snapshot.items.filter(item => item.kind === 'task' && test(item));
  } catch (error) { syntaxError = errorMessage(error); }
  async function save() {
    if (syntaxError) return;
    try {
      const filter = { id: editing ?? crypto.randomUUID(), name: name.trim(), query, favorite };
      await dispatch({ type: 'workspace.save', workspace: { ...snapshot.workspace, filters: editing ? snapshot.workspace.filters.map(item => item.id === editing ? filter : item) : [...snapshot.workspace.filters, filter] } });
      setEditing(filter.id);
      setFailure('');
    } catch (error) { setFailure(errorMessage(error)); }
  }
  return <div className="filters-layout">
    <section className="tool-panel">
      <h2>Saved filters</h2>
      {snapshot.workspace.filters.map(filter => <div className="saved-filter" key={filter.id}>
        <Button
          variant="ghost"
          onClick={() => { setEditing(filter.id); setName(filter.name); setQuery(filter.query); setFavorite(filter.favorite); }}>
          {filter.favorite && <Star size="0.875rem" />}
          {filter.name}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => onFilter(filter.id)}>Open</Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove filter ${filter.name}`}
          onClick={() => void dispatch({ type: 'workspace.save', workspace: { ...snapshot.workspace, filters: snapshot.workspace.filters.filter(item => item.id !== filter.id) } }).catch(error => setFailure(errorMessage(error)))}>
          <X size="0.875rem" />
        </Button>
      </div>)}
      {!snapshot.workspace.filters.length && <p className="muted">Save a query to keep it nearby.</p>}
      <Button variant="outline" size="sm" onClick={() => { setEditing(null); setName(''); setQuery('today'); }}>
        <Plus size="0.875rem" />New filter
      </Button>
      <h2>Labels</h2>
      <div className="label-cloud">
        {[...new Set([...snapshot.workspace.labels, ...snapshot.items.flatMap(item => item.tags)])].sort().map(label => <Button variant="secondary" size="xs" key={label} onClick={() => setQuery(`@${label}`)}>@{label}</Button>)}
      </div>
      <form
        className="detail-line"
        onSubmit={event => {
          event.preventDefault();
          if (label.trim()) void dispatch({ type: 'workspace.save', workspace: { ...snapshot.workspace, labels: [...new Set([...snapshot.workspace.labels, label.trim()])] } }).then(() => setLabel('')).catch(error => setFailure(errorMessage(error)));
        }}>
        <Input
          aria-label="New label"
          value={label}
          onChange={event => setLabel(event.target.value)}
          maxLength={40}
          pattern="[\p{L}\p{N}_-]+"
          placeholder="Label name" />
        <Button size="sm" variant="outline" disabled={!label.trim()}>Add</Button>
      </form>
    </section>
    <section className="tool-panel filter-editor">
      <h2>{editing ? 'Edit filter' : 'New filter'}</h2>
      <Label className="field">
        Filter name
        <Input value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Focus today" />
      </Label>
      <Label className="field">
        Query
        <Textarea aria-label="Filter query" value={query} onChange={event => setQuery(event.target.value)} rows={3} maxLength={1000} />
      </Label>
      <p className="muted">Use today, overdue, no-date, p1–p4, #Project, @label, assigned:email, due:YYYY-MM-DD or a word. Join with &amp; / |, negate with !, and group with parentheses. Quote project names containing spaces.</p>
      <Label className="checkbox-label">
        <Checkbox checked={favorite} onCheckedChange={value => setFavorite(value === true)} />Add to favorites
      </Label>
      {(syntaxError || failure) && <p className="note-error" role="alert">{syntaxError || failure}</p>}
      <div className="group-label"><span>Live preview</span><span>{matches.length} tasks</span></div>
      {matches.length ? renderTasks(matches) : !syntaxError && <Empty title="No matching tasks">Adjust the query to preview other tasks.</Empty>}
      <Button disabled={!name.trim() || !query.trim() || !!syntaxError} onClick={() => void save()}>Save filter</Button>
    </section>
  </div>;
}

export function Templates({ snapshot, dispatch, projectId, onClose }: { snapshot: Snapshot; dispatch: Dispatch; projectId: string | null; onClose: () => void; }) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const source = snapshot.items.filter(item => item.kind === 'task' && !item.done && item.task.projectId === projectId && !item.task.parentId);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="workspace-dialog" aria-describedby={undefined}>
      <DialogTitle>Task templates</DialogTitle>
      <p className="muted">
        Apply a reusable checklist to
        {snapshot.workspace.projects.find(project => project.id === projectId)?.name ?? 'No project'}.
      </p>
      <div className="template-list">
        {snapshot.workspace.templates.map(template => <div className="detail-line" key={template.id}>
          <span>{template.name}<small>{template.tasks.length} tasks</small></span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void dispatch({ type: 'template.apply', id: template.id, projectId }).then(onClose).catch(error => setFailure(errorMessage(error))).finally(() => setBusy(false));
            }}>Apply</Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove template ${template.name}`}
            disabled={busy}
            onClick={() => void dispatch({ type: 'workspace.save', workspace: { ...snapshot.workspace, templates: snapshot.workspace.templates.filter(item => item.id !== template.id) } }).catch(error => setFailure(errorMessage(error)))}>
            <X size="0.875rem" />
          </Button>
        </div>)}
      </div>
      <Label className="field">
        Template name
        <Input value={name} maxLength={100} onChange={event => setName(event.target.value)} />
      </Label>
      <Label className="field">
        Tasks, one per line
        <Textarea
          value={text}
          maxLength={50000}
          rows={4}
          onChange={event => setText(event.target.value)}
          placeholder="Prepare agenda\nReview notes\nSend follow-up" />
      </Label>
      <div className="detail-line">
        <Button variant="outline" disabled={!source.length} onClick={() => setText(source.map(item => item.title).join('\n'))}>Use current tasks</Button>
        <Button
          disabled={busy || !name.trim() || !text.trim()}
          onClick={() => {
            setBusy(true);
            void dispatch({ type: 'workspace.save', workspace: { ...snapshot.workspace, templates: [...snapshot.workspace.templates, { id: crypto.randomUUID(), name, tasks: text.split('\n').filter(title => title.trim()).map(title => ({ title: title.trim(), body: '' })) }] } }).then(() => { setName(''); setText(''); }).catch(error => setFailure(errorMessage(error))).finally(() => setBusy(false));
          }}>Save template</Button>
      </div>
      {failure && <p role="alert" className="note-error">{failure}</p>}
    </DialogContent>
  </Dialog>;
}

export function CommandMenu({ snapshot, actions, onClose, onTask, onProject }: { snapshot: Snapshot; actions: { title: string; run: () => void; }[]; onClose: () => void; onTask: (item: Item) => void; onProject: (id: string) => void; }) {
  const [query, setQuery] = useState('');
  const commands = [...actions, ...snapshot.workspace.projects.map(project => ({ title: `Project: ${project.name}`, run: () => onProject(project.id) })), ...snapshot.items.filter(item => item.kind === 'task' && !item.done).map(item => ({ title: item.title, run: () => onTask(item) }))].filter(action => action.title.toLowerCase().includes(query.toLowerCase())).slice(0, 40);
  const [selected, setSelected] = useState(0);
  const activeCommand = useRef<HTMLButtonElement>(null);
  useEffect(() => { activeCommand.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  function run(index: number) { const command = commands[index]; if (command) { onClose(); command.run(); } }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="command-menu" aria-describedby={undefined}>
      <DialogTitle>Commands &amp; search</DialogTitle>
      <div className="search">
        <Search size="1rem" />
        <Input
          autoFocus
          aria-label="Search commands"
          value={query}
          placeholder="Find a task, project, or action…"
          onChange={event => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={event => {
            if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
              event.preventDefault();
              if (event.key === 'Enter') run(selected); else setSelected(index => Math.max(0, Math.min(commands.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
            }
          }} />
      </div>
      <div className="command-results">
        {commands.map((command, index) => <Button variant="ghost" key={`${index}-${command.title}`} ref={index === selected ? activeCommand : undefined}
            className={index === selected ? 'active' : ''} onClick={() => run(index)}>
          <Hash size="0.9375rem" />
          {command.title}
        </Button>)}
        {!commands.length && <p className="muted">No matching commands or tasks.</p>}
      </div>
      <p className="muted">↑ ↓ to choose · Enter to open · Esc to close</p>
      <p className="muted command-shortcuts">In task lists: J/K or ↑ ↓ move · Enter opens · E completes · Q adds a task · / searches · ⌘Z undoes</p>
    </DialogContent>
  </Dialog>;
}
