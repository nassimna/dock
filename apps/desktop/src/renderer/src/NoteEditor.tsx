import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type ReactNodeViewProps, type JSONContent } from "@tiptap/react";
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus";
import { sinkListItem, liftListItem } from "@tiptap/pm/schema-list";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import TaskItem from "@tiptap/extension-task-item";
import { TextStyle, Color, BackgroundColor } from "@tiptap/extension-text-style";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Bold, ChevronDown, Code, GripVertical, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, ListTree, MessageSquare, Minus, MoreHorizontal, Plus, Quote, Redo2, Search, Strikethrough, Table2, Type, Underline, Undo2 } from "lucide-react";
import type { Item } from "@dock/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout, NoteBlockColors, NoteDetails, NoteDetailsContent, NoteDetailsSummary, noteMarkup, TableOfContents, jumpToHeading, noteColors, noteHeadings } from "./NoteExtensions";

const showSelection: NonNullable<BubbleMenuProps["shouldShow"]> = ({ editor, state }) =>
  editor.isEditable && !state.selection.empty && !editor.isActive("codeBlock") &&
  (editor.isFocused || Boolean(document.activeElement?.closest(".note-selection-toolbar, .note-format-menu, .note-link-popover")));

function ChecklistItem({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const checked = node.attrs.checked === true;
  const editable = useEditorState({ editor, selector: ({ editor }) => editor.isEditable });
  return <NodeViewWrapper as="li" data-type="taskItem" data-checked={checked}>
    <span className="note-check" contentEditable={false}><Checkbox checked={checked} disabled={!editable} aria-label={`${checked ? "Reopen" : "Complete"} ${node.textContent}`}
      onCheckedChange={checked => { if (editor.isEditable) updateAttributes({ checked: checked === true }); }} /></span><NodeViewContent />
  </NodeViewWrapper>;
}
const ThemedTaskItem = TaskItem.extend({ addNodeView() { return ReactNodeViewRenderer(ChecklistItem); } });

export function NoteEditor({ value, onChange, notes, onOpenNote, children, readOnly = false, label = "Note body" }: {
  value: string; onChange: (value: string) => void; notes: Item[];
  onOpenNote: (id: string) => void; children: ReactNode;
  readOnly?: boolean; label?: string;
}) {
  const [mode, setMode] = useState<"write" | "source" | "read">(readOnly ? "read" : "write");
  const sourceMode = useRef(false);
  const [sourceText, setSourceText] = useState(value);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const commandRange = useRef<{ from: number; to: number } | null>(null);
  const insertAfter = useRef<number | null>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [noteLinkOpen, setNoteLinkOpen] = useState(false);
  const [noteQuery, setNoteQuery] = useState("");
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [blockTop, setBlockTop] = useState(0);
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const dragMoved = useRef(false);
  const drag = useRef<{ from: number; size: number; content: JSONContent; startY: number; target: number | null } | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: {
        openOnClick: false, autolink: false, protocols: ["dock-note"],
        isAllowedUri: (url, context) => /^dock-note:\/\/[0-9a-f-]{36}$/.test(url) || (/^(https?:|mailto:)/i.test(url) && context.defaultValidate(url)),
      } }),
      Markdown.configure({ markedOptions: { breaks: true } }),
      TaskList, ThemedTaskItem.configure({ nested: true }), TextStyle, Color, BackgroundColor,
      NoteBlockColors, Callout, NoteDetails, NoteDetailsContent, NoteDetailsSummary,
      Table.configure({ resizable: false, renderWrapper: true, cellMinWidth: 80 }), TableCell, TableHeader, TableRow, TableOfContents,
    ],
    content: value, contentType: "markdown", editable: !readOnly, shouldRerenderOnTransaction: false, injectCSS: false,
    editorProps: {
      attributes: { role: "textbox", "aria-label": label, "aria-readonly": String(readOnly), "aria-multiline": "true", spellcheck: "true" },
      handleKeyDown(view, event) {
        if (readOnly) return false;
        const { $from } = view.state.selection;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault(); setUrl($from.marks().find(mark => mark.type.name === "link")?.attrs.href ?? "");
          setLinkError(""); setLinkOpen(true); return true;
        }
        if (event.key === "Tab") {
          for (let depth = $from.depth; depth > 0; depth--) {
            const type = $from.node(depth).type;
            if (["listItem", "taskItem"].includes(type.name)) {
              event.preventDefault();
              (event.shiftKey ? liftListItem(type) : sinkListItem(type))(view.state, view.dispatch);
              return true;
            }
          }
        }
        return false;
      },
      handleTextInput(view, from, _to, text) {
        const before = view.state.doc.resolve(from).parent.textContent.slice(0, view.state.doc.resolve(from).parentOffset);
        if (text === "/" && !before.trim() && !view.state.doc.resolve(from).parent.type.spec.code) {
          commandRange.current = { from, to: from + 1 };
          insertAfter.current = null;
          setCommandQuery(""); setCommandIndex(0); setCommandOpen(true);
        }
        return false;
      },
      handleDOMEvents: { click(_view, event) {
        if (readOnly && (event.target as HTMLElement).closest("a[href]")) { event.preventDefault(); return true; }
        const anchor = (event.target as HTMLElement).closest('a[href^="dock-note://"]');
        if (anchor) { event.preventDefault(); onOpenNote(anchor.getAttribute("href")!.slice(12)); return true; }
        const external = (event.target as HTMLElement).closest("a[href]");
        const href = external?.getAttribute("href");
        if (href && /^(https?:|mailto:)/i.test(href)) {
          event.preventDefault();
          if (mode === "read" || event.metaKey || event.ctrlKey) window.open(href, "_blank");
          return true;
        }
        return false;
      } },
    },
    onUpdate: ({ editor }) => {
      const markdown = noteMarkup(editor); lastEmitted.current = markdown;
      if (sourceMode.current) setSourceText(markdown);
      onChangeRef.current(markdown);
    },
  });
  const bubbleOptions = useMemo<BubbleMenuProps["options"]>(() => ({
    placement: "top", offset: 8,
    flip: { boundary: editor?.view.dom },
    shift: { boundary: editor?.view.dom, padding: 4 },
  }), [editor]);
  const documentStats = useRef<{
    doc: NonNullable<typeof editor>["state"]["doc"];
    headings: ReturnType<typeof noteHeadings>;
    words: number;
  } | null>(null);
  const state = useEditorState({ editor, selector: ({ editor }) => {
    if (!editor) return null;
    const { selection, doc } = editor.state;
    if (documentStats.current?.doc !== doc) documentStats.current = {
      doc, headings: noteHeadings(editor), words: editor.getText().trim().split(/\s+/).filter(Boolean).length,
    };
    const pos = selection.$from.depth ? selection.$from.before(1) : selection.from;
    const block = doc.nodeAt(pos);
    let table = null;
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      if (selection.$from.node(depth).type.name === "table") { table = selection.$from.node(depth); break; }
    }
    return {
      bold: editor.isActive("bold"), italic: editor.isActive("italic"), underline: editor.isActive("underline"),
      strike: editor.isActive("strike"), inlineCode: editor.isActive("code"), link: editor.isActive("link"),
      undo: editor.can().undo(), redo: editor.can().redo(), table: editor.isActive("table"), rows: table?.childCount ?? 0, columns: table?.firstChild?.childCount ?? 0,
      pos, block: block?.toJSON(), size: block?.nodeSize ?? 0,
      headings: documentStats.current.headings, words: documentStats.current.words,
      selectedText: doc.textBetween(selection.from, selection.to, " "), from: selection.from, to: selection.to,
    };
  } });
  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
      lastEmitted.current = value; setSourceText(value);
    }
  }, [editor, value]);
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(mode === "write" && !readOnly, false);
    editor.commands.setMeta("noteMode", mode);
    sourceMode.current = mode === "source";
    setCommandOpen(false); setLinkOpen(false); setFormatOpen(false); setBlockMenuOpen(false);
  }, [editor, mode, readOnly]);
  useEffect(() => {
    if (!editor || !state || !container.current) return;
    const position = () => {
      const dom = editor.view.nodeDOM(state.pos);
      if (dom instanceof HTMLElement && container.current)
        setBlockTop(dom.getBoundingClientRect().top - container.current.getBoundingClientRect().top);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [editor, state?.pos, state?.block, mode]);
  useEffect(() => {
    if (!editor) return;
    const move = (event: PointerEvent) => {
      if (!drag.current || Math.abs(event.clientY - drag.current.startY) < 5) return;
      const found = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!found) return;
      const resolved = editor.state.doc.resolve(found.pos);
      let target = resolved.depth ? resolved.before(1) : found.pos;
      const targetNode = editor.state.doc.nodeAt(target);
      const targetDOM = editor.view.nodeDOM(target);
      if (targetNode && targetDOM instanceof HTMLElement) {
        const rect = targetDOM.getBoundingClientRect();
        if (event.clientY > rect.top + rect.height / 2) target += targetNode.nodeSize;
      }
      dragMoved.current = true;
      drag.current.target = target; setDragTarget(target);
    };
    const end = () => {
      const current = drag.current; drag.current = null; setDragTarget(null);
      if (!current || current.target === null || (current.target >= current.from && current.target <= current.from + current.size)) return;
      const target = current.target > current.from ? current.target - current.size : current.target;
      editor.chain().focus().deleteRange({ from: current.from, to: current.from + current.size }).insertContentAt(target, current.content).run();
    };
    const cancel = () => { drag.current = null; setDragTarget(null); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", end); document.addEventListener("pointercancel", cancel);
    return () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); document.removeEventListener("pointercancel", cancel); };
  }, [editor]);
  if (!editor || !state) return <p role="status" className="muted">Opening note editor…</p>;

  function openCommands(after: number | null = null) {
    commandRange.current = null; insertAfter.current = after;
    setCommandQuery(""); setCommandIndex(0); setCommandOpen(true);
  }
  function insert(content: JSONContent) {
    let chain = editor!.chain().focus();
    if (commandRange.current) chain = chain.deleteRange(commandRange.current);
    chain.command(({ tr, commands }) => {
      const selection = tr.selection;
      const currentPos = selection.$from.depth ? selection.$from.before(1) : selection.from;
      const block = tr.doc.nodeAt(currentPos);
      const replaceEmpty = block?.type.name === "paragraph" && !block.content.size && insertAfter.current === null;
      const from = insertAfter.current ?? (replaceEmpty ? currentPos : currentPos + (block?.nodeSize ?? 0));
      return commands.insertContentAt(replaceEmpty ? { from, to: from + block!.nodeSize } : from, content);
    }).run();
    commandRange.current = null; insertAfter.current = null; setCommandOpen(false);
  }
  function insertInline(content: JSONContent[]) {
    if (insertAfter.current !== null) {
      insert({ type: "paragraph", content });
      return;
    }
    let chain = editor!.chain().focus();
    if (commandRange.current) chain = chain.deleteRange(commandRange.current);
    chain.insertContent(content).run();
    commandRange.current = null; setCommandOpen(false);
  }
  const toggle = (level: number): JSONContent => ({ type: "details", attrs: { open: true }, content: [
    { type: "detailsSummary", attrs: { level }, content: [{ type: "text", text: "Toggle" }] },
    { type: "detailsContent", content: [{ type: "paragraph" }] },
  ] });
  const commands = [
    { label: "Text", search: "paragraph p", icon: Type, node: { type: "paragraph" } },
    { label: "Heading 1", search: "h1 title", icon: Heading1, node: { type: "heading", attrs: { level: 1 } } },
    { label: "Heading 2", search: "heading h2", icon: Heading2, node: { type: "heading", attrs: { level: 2 } } },
    { label: "Heading 3", search: "h3", icon: Heading3, node: { type: "heading", attrs: { level: 3 } } },
    { label: "Bulleted list", search: "bullet unordered ul", icon: List, node: { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] } },
    { label: "Numbered list", search: "ordered ol", icon: ListOrdered, node: { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] } },
    { label: "Checklist", search: "todo task check", icon: ListChecks, node: { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] } },
    { label: "Quote", search: "blockquote", icon: Quote, node: { type: "blockquote", content: [{ type: "paragraph" }] } },
    { label: "Divider", search: "rule hr", icon: Minus, node: { type: "horizontalRule" } },
    { label: "Callout", search: "tip note box", icon: MessageSquare, node: { type: "callout", attrs: { emoji: "💡" }, content: [{ type: "paragraph" }] } },
    { label: "Toggle list", search: "details collapse", icon: ChevronDown, node: toggle(0) },
    { label: "Toggle heading 1", search: "h1 collapse", icon: Heading1, node: toggle(1) },
    { label: "Toggle heading 2", search: "h2 collapse", icon: Heading2, node: toggle(2) },
    { label: "Toggle heading 3", search: "h3 collapse", icon: Heading3, node: toggle(3) },
    { label: "Simple table", search: "table rows cells columns", icon: Table2, node: { type: "table", content: Array.from({ length: 3 }, (_, row) => ({ type: "tableRow", content: Array.from({ length: 3 }, () => ({ type: row ? "tableCell" : "tableHeader", content: [{ type: "paragraph" }] })) })) } },
    { label: "Code block", search: "pre code", icon: Code, node: { type: "codeBlock" } },
    { label: "Table of contents", search: "toc outline headings", icon: ListTree, node: { type: "tableOfContents" } },
    { label: "Link to note", search: "page mention", icon: Link2, run: () => { setNoteQuery(""); setNoteLinkOpen(true); setCommandOpen(false); } },
    { label: "Today’s date", search: "date today", icon: Type, run: () => {
      insertInline([{ type: "text", text: new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) }]);
    } },
  ];
  const matches = commands.filter(command => `${command.label} ${command.search}`.toLowerCase().includes(commandQuery.replace(/^\//, "").trim().toLowerCase()));
  function runCommand(index: number) {
    const command = matches[index]; if (!command) return;
    if (command.run) command.run(); else insert(command.node!);
  }
  function beginLink() { setUrl(editor!.getAttributes("link").href ?? ""); setLinkError(""); setLinkOpen(true); }
  function saveLink(event: React.FormEvent) {
    event.preventDefault();
    try {
      const link = new URL(url);
      if (!["https:", "http:", "mailto:"].includes(link.protocol)) throw new Error();
      if (editor!.state.selection.empty && !editor!.isActive("link"))
        editor!.chain().focus().insertContent({ type: "text", text: link.href, marks: [{ type: "link", attrs: { href: link.href } }] }).run();
      else editor!.chain().focus().extendMarkRange("link").setLink({ href: link.href }).run();
      setLinkOpen(false); setLinkError("");
    } catch { setLinkError("Enter a valid https, http or email link."); }
  }
  function moveBlock(direction: -1 | 1) {
    const { pos, size, block } = state!; if (!block) return;
    const adjacent = direction < 0 ? editor!.state.doc.resolve(pos).nodeBefore : editor!.state.doc.nodeAt(pos + size);
    if (!adjacent) return;
    const target = direction < 0 ? pos - adjacent.nodeSize : pos + adjacent.nodeSize;
    editor!.chain().focus().deleteRange({ from: pos, to: pos + size }).insertContentAt(target, block).run(); setBlockMenuOpen(false);
  }
  function convert(type: string, level = 0) {
    const block = editor!.schema.nodeFromJSON(state!.block!);
    const content = block.isTextblock ? block.toJSON().content : block.textContent ? [{ type: "text", text: block.textContent }] : [];
    const node: JSONContent = { type, ...(level ? { attrs: { level } } : {}), content };
    editor!.chain().focus().insertContentAt({ from: state!.pos, to: state!.pos + state!.size }, node).run(); setBlockMenuOpen(false);
  }
  const marks = [
    { label: "Bold", icon: Bold, active: state.bold, run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", icon: Italic, active: state.italic, run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Underline", icon: Underline, active: state.underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { label: "Strikethrough", icon: Strikethrough, active: state.strike, run: () => editor.chain().focus().toggleStrike().run() },
    { label: "Inline code", icon: Code, active: state.inlineCode, run: () => editor.chain().focus().toggleCode().run() },
  ];
  function palette(block: boolean) {
    return <div className="note-color-palette">{["Text color", "Background color"].map((label, index) => <div key={label}><span className="group-label">{label}</span><div className="note-color-grid">
      {noteColors.map(color => <Button key={color} variant="ghost" size="icon-xs" aria-label={`${label}: ${color}`} title={`${label}: ${color}`}
        style={{ color: color === "default" || index ? "var(--foreground)" : `var(--note-color-${color})`, backgroundColor: index && color !== "default" ? `var(--note-bg-${color})` : "var(--card)" }}
        onMouseDown={event => event.preventDefault()} onClick={() => {
          const selected = color === "default" ? null : `var(--note-${index ? "bg" : "color"}-${color})`;
          if (block) editor!.chain().focus().updateAttributes(state!.block!.type!, { [index ? "backgroundColor" : "textColor"]: selected }).run();
          else if (index) { if (selected) editor!.chain().focus().setBackgroundColor(selected).run(); else editor!.chain().focus().unsetBackgroundColor().run(); }
          else { if (selected) editor!.chain().focus().setColor(selected).run(); else editor!.chain().focus().unsetColor().run(); }
        }}>A</Button>)}
    </div></div>)}</div>;
  }
  const commandMenu = <Popover open={commandOpen} onOpenChange={open => { setCommandOpen(open); if (!open) { commandRange.current = null; insertAfter.current = null; } }}>
    <PopoverTrigger asChild><Button variant="ghost" size="xs" aria-label="Commands" onClick={() => openCommands()}><Plus size="0.875rem" /> Commands</Button></PopoverTrigger>
    <PopoverContent align="start" className="note-command-menu" onCloseAutoFocus={event => event.preventDefault()}>
      <div className="note-command-search"><Search size="0.8125rem" /><Input size="xs" aria-label="Search commands" placeholder="Search commands…" value={commandQuery} onChange={event => { setCommandQuery(event.target.value); setCommandIndex(0); }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setCommandIndex(index => matches.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0); }
          if (event.key === "Enter") { event.preventDefault(); runCommand(commandIndex); }
        }} /></div>
      <div className="note-command-results" role="listbox" aria-label="Block commands">{matches.map((command, index) => <Button key={command.label} variant="ghost" size="xs" role="option" aria-selected={index === commandIndex}
        ref={element => { if (index === commandIndex && commandOpen) element?.scrollIntoView({ block: "nearest" }); }}
        onMouseEnter={() => setCommandIndex(index)} onClick={() => runCommand(index)}><command.icon size="0.875rem" /><span>{command.label}</span></Button>)}
        {!matches.length && <p className="muted">No commands found.</p>}
      </div>
    </PopoverContent>
  </Popover>;
  const formatting = <Popover open={formatOpen} onOpenChange={setFormatOpen}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="More formatting"><MoreHorizontal size="0.9375rem" /></Button></PopoverTrigger>
    <PopoverContent align="end" className="note-format-menu" onFocusOutside={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>
      <Button variant="ghost" size="xs" onMouseDown={event => event.preventDefault()} onClick={beginLink}><Link2 size="0.875rem" /> Add or edit link</Button>
      <div className="note-format-marks">{marks.map(action => <Button key={action.label} variant="ghost" size="icon-xs" aria-label={action.label} aria-pressed={action.active} onMouseDown={event => event.preventDefault()} onClick={action.run}><action.icon size="0.9375rem" /></Button>)}</div>
      <div className="note-format-blocks">{[["Text", "paragraph", 0], ["Heading 1", "heading", 1], ["Heading 2", "heading", 2], ["Heading 3", "heading", 3]].map(([label, type, level]) => <Button key={label} variant="ghost" size="xs" onMouseDown={event => event.preventDefault()} onClick={() => { if (type === "heading") editor!.chain().focus().setHeading({ level: Number(level) as 1 | 2 | 3 }).run(); else editor!.chain().focus().setParagraph().run(); }}>{label}</Button>)}</div>
      {palette(false)}
      <Button variant="ghost" size="xs" onMouseDown={event => event.preventDefault()} onClick={() => editor!.chain().focus().unsetAllMarks().run()}>Clear formatting</Button>
      <div className="note-indent-actions"><Button variant="ghost" size="xs" disabled={!editor.can().sinkListItem(editor.isActive("taskList") ? "taskItem" : "listItem")} onClick={() => editor!.chain().focus().sinkListItem(editor.isActive("taskList") ? "taskItem" : "listItem").run()}>Indent</Button><Button variant="ghost" size="xs" disabled={!editor.can().liftListItem(editor.isActive("taskList") ? "taskItem" : "listItem")} onClick={() => editor!.chain().focus().liftListItem(editor.isActive("taskList") ? "taskItem" : "listItem").run()}>Outdent</Button></div>
      {!!state.selectedText && <small>{state.selectedText.trim().split(/\s+/).filter(Boolean).length} words · {state.selectedText.length} characters selected</small>}
    </PopoverContent>
  </Popover>;
  return <div className="rich-note" ref={container}>
    {!readOnly && <div className="editor-toolbar">
      <div className="note-mode-switch" aria-label="Note editing mode">{([['write', 'Write'], ['source', 'Markdown'], ['read', 'Read']] as const).map(([value, label]) => <Button key={value} variant="ghost" size="xs" aria-pressed={mode === value} onClick={() => { if (value === "source") setSourceText(noteMarkup(editor)); setMode(value); }}>{label}</Button>)}</div>
      <div className="editor-mode-actions">{mode === "write" && <>{commandMenu}{formatting}</>}
        {mode !== "read" && <><Button variant="ghost" size="icon-xs" aria-label="Undo note edit" disabled={!state.undo} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().undo().run()}><Undo2 size="0.875rem" /></Button><Button variant="ghost" size="icon-xs" aria-label="Redo note edit" disabled={!state.redo} onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().redo().run()}><Redo2 size="0.875rem" /></Button></>}
        <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Note outline"><ListTree size="0.9375rem" /></Button></PopoverTrigger><PopoverContent align="end" className="note-outline">{state.headings.length ? state.headings.map(heading => <Button key={heading.pos} variant="ghost" size="xs" onClick={() => jumpToHeading(editor, heading.pos)} style={{ paddingLeft: `${(heading.level - 1) * 0.75}rem` }}>{heading.title}</Button>) : <p className="muted">Add headings to see an outline.</p>}</PopoverContent></Popover>
      </div>
    </div>}
    {mode === "write" && <BubbleMenu editor={editor} options={bubbleOptions} className="note-selection-toolbar" shouldShow={showSelection}>
      {marks.map(action => <Button key={action.label} variant="ghost" size="icon-xs" aria-label={action.label} aria-pressed={action.active} onMouseDown={event => event.preventDefault()} onClick={action.run}><action.icon size="0.9375rem" /></Button>)}
      <Button variant="ghost" size="icon-xs" aria-label="Add or edit link" onMouseDown={event => event.preventDefault()} onClick={beginLink}><Link2 size="0.9375rem" /></Button>
      <Popover><PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Text and background color" onMouseDown={event => event.preventDefault()}><Type size="0.9375rem" /></Button></PopoverTrigger><PopoverContent className="note-format-menu" onFocusOutside={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>{palette(false)}</PopoverContent></Popover>
      <Button variant="ghost" size="icon-xs" aria-label="Open formatting menu" onMouseDown={event => event.preventDefault()} onClick={() => setFormatOpen(true)}><MoreHorizontal size="0.9375rem" /></Button>
    </BubbleMenu>}
    <Popover open={linkOpen} onOpenChange={setLinkOpen}>
      <PopoverAnchor asChild><span className="note-menu-anchor" /></PopoverAnchor>
      <PopoverContent className="note-link-popover" align="end" onCloseAutoFocus={event => event.preventDefault()}><form className="link-form" onSubmit={saveLink}>
        <Input size="xs" aria-label="Link URL" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com" required />
        <div><Button size="xs" type="submit">Apply link</Button><Button variant="ghost" size="xs" type="button" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }}>Remove link</Button></div>
        {linkError && <p className="note-error" role="alert">{linkError}</p>}
      </form></PopoverContent>
    </Popover>
    <Popover open={noteLinkOpen} onOpenChange={setNoteLinkOpen}>
      <PopoverAnchor asChild><span className="note-menu-anchor" /></PopoverAnchor><PopoverContent className="note-picker" onCloseAutoFocus={event => event.preventDefault()}>
        <Input size="xs" aria-label="Search notes to link" placeholder="Search notes…" value={noteQuery} onChange={event => setNoteQuery(event.target.value)} />
        <div className="note-picker-options">{notes.filter(note => note.title.toLowerCase().includes(noteQuery.toLowerCase())).map(note => <Button variant="ghost" size="xs" key={note.id} onClick={() => {
          insertInline([{ type: "text", text: note.title, marks: [{ type: "link", attrs: { href: `dock-note://${note.id}` } }] }, { type: "text", text: " " }]); setNoteLinkOpen(false);
        }}><Link2 size="0.875rem" />{note.title}</Button>)}</div>
        {!notes.some(note => note.title.toLowerCase().includes(noteQuery.toLowerCase())) && <p className="muted">No matching notes.</p>}
      </PopoverContent>
    </Popover>
    {mode === "write" && state.block && <div className="note-block-tools" style={{ top: blockTop }}>
      <Button variant="ghost" size="icon-xs" aria-label="Insert below this block" onMouseDown={event => event.preventDefault()} onClick={() => openCommands(state.pos + state.size)}><Plus size="0.8125rem" /></Button>
      <Popover open={blockMenuOpen} onOpenChange={setBlockMenuOpen}><PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Block actions; drag to reorder" onClick={event => { if (dragMoved.current) { event.preventDefault(); dragMoved.current = false; } }} onMouseDown={event => event.preventDefault()} onPointerDown={event => {
        if (event.button !== 0) return;
        dragMoved.current = false;
        drag.current = { from: state.pos, size: state.size, content: state.block!, startY: event.clientY, target: null };
      }}><GripVertical size="0.8125rem" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="note-block-menu" onFocusOutside={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>
          <span className="group-label">Turn into</span><div className="note-format-blocks">{[0, 1, 2, 3].map(level => <Button key={level} variant="ghost" size="xs" onClick={() => convert(level ? "heading" : "paragraph", level)}>{level ? `Heading ${level}` : "Text"}</Button>)}</div>
          <Button variant="ghost" size="xs" onClick={() => { editor.chain().focus().toggleBlockquote().run(); setBlockMenuOpen(false); }}>Quote</Button>
          {palette(true)}
          <Button variant="ghost" size="xs" disabled={state.pos === 0} onClick={() => moveBlock(-1)}>Move up</Button>
          <Button variant="ghost" size="xs" disabled={state.pos + state.size >= editor.state.doc.content.size} onClick={() => moveBlock(1)}>Move down</Button>
          <Button variant="ghost" size="xs" onClick={() => { editor.chain().focus().insertContentAt(state.pos + state.size, state.block!).run(); setBlockMenuOpen(false); }}>Duplicate block</Button>
          <Button variant="ghost" size="xs" className="danger" onClick={() => { editor.chain().focus().deleteRange({ from: state.pos, to: state.pos + state.size }).run(); setBlockMenuOpen(false); }}>Delete block</Button>
        </PopoverContent>
      </Popover>
    </div>}
    {dragTarget !== null && <div className="note-drag-state" role="status">Release to move this block</div>}
    {mode === "write" && state.table && <div className="note-table-toolbar" role="toolbar" aria-label="Table actions">
      <Select value="" onValueChange={action => {
        const chain = editor.chain().focus();
        if (action === "row-after") chain.addRowAfter().run();
        if (action === "row-before") chain.addRowBefore().run();
        if (action === "column-after") chain.addColumnAfter().run();
        if (action === "column-before") chain.addColumnBefore().run();
        if (action === "delete-row") chain.deleteRow().run();
        if (action === "delete-column") chain.deleteColumn().run();
        if (action === "header") chain.toggleHeaderRow().run();
        if (action === "clear") { const { $from } = editor.state.selection; for (let depth = $from.depth; depth > 0; depth--) { if (["tableCell", "tableHeader"].includes($from.node(depth).type.name)) { chain.deleteRange({ from: $from.start(depth), to: $from.end(depth) }).run(); break; } } }
      }}><SelectTrigger aria-label="Table actions" size="xs"><SelectValue placeholder="Table actions" /></SelectTrigger><SelectContent>{[["row-after", "Add row below"], ["row-before", "Add row above"], ["column-after", "Add column after"], ["column-before", "Add column before"], ["delete-row", "Delete row"], ["delete-column", "Delete column"], ["header", "Toggle header row"], ["clear", "Clear cell"]].map(([value, label]) => <SelectItem key={value} value={value!} disabled={(value === "delete-row" && state.rows <= 1) || (value === "delete-column" && state.columns <= 1)}>{label}</SelectItem>)}</SelectContent></Select>
    </div>}
    {mode === "source" && sourceText.trim().startsWith("<") && <p className="note-source-hint">Rich blocks and colors use HTML in this Markdown source.</p>}
    <div className="note-writing-area">
      {mode === "source" ? <Textarea className="note-body markdown-source" aria-label="Markdown source" value={sourceText} onChange={event => {
        const markdown = event.target.value; setSourceText(markdown); lastEmitted.current = markdown;
        editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false }); onChange(markdown);
      }} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) editor.commands.redo(); else editor.commands.undo(); } }} maxLength={200000} placeholder="Write Markdown…" /> : <EditorContent editor={editor} className="note-body rich-text" data-mode={mode} />}
      {!value && mode === "write" && <p className="editor-hint">Start writing, or type / for commands.</p>}
    </div>
    {mode === "write" && <Button variant="ghost" size="xs" className="note-add-block" onClick={() => openCommands(editor.state.doc.content.size)}><Plus size="0.8125rem" /> Add a block</Button>}
    <footer className="editor-footer"><span>{state.words} words</span>{children}</footer>
  </div>;
}
