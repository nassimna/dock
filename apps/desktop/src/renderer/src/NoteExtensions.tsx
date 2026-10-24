import { useEffect, useState } from "react";
import { Node, Extension, createBlockMarkdownSpec, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type ReactNodeViewProps, type Editor } from "@tiptap/react";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const noteColors = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export function noteMarkup(editor: Editor) {
  let rich = false;
  editor.state.doc.descendants(node => {
    if (["callout", "details", "table", "tableOfContents"].includes(node.type.name) ||
        node.attrs.textColor || node.attrs.backgroundColor || node.marks.some(mark => mark.type.name === "textStyle")) rich = true;
    return !rich;
  });
  return rich ? editor.getHTML() : editor.getMarkdown();
}
export const NoteBlockColors = Extension.create({
  name: "noteBlockColors",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading", "blockquote", "codeBlock", "callout", "details", "table", "bulletList", "orderedList", "taskList", "horizontalRule"], attributes: {
      textColor: { default: null, parseHTML: element => element.style.color || null,
        renderHTML: attrs => attrs.textColor ? { style: `color:${attrs.textColor}` } : {} },
      backgroundColor: { default: null, parseHTML: element => element.style.backgroundColor || null,
        renderHTML: attrs => attrs.backgroundColor ? { style: `background-color:${attrs.backgroundColor}` } : {} },
    } }];
  },
});
function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const editable = useEditorState({ editor, selector: ({ editor }) => editor.isEditable });
  return <NodeViewWrapper className="note-callout" data-type="callout" style={{ color: node.attrs.textColor, backgroundColor: node.attrs.backgroundColor }}>
    <div contentEditable={false}><Popover>
      <PopoverTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Change callout icon" disabled={!editable}>{node.attrs.emoji}</Button></PopoverTrigger>
      <PopoverContent className="callout-icons"><Input aria-label="Callout icon" value={node.attrs.emoji} maxLength={16} onChange={event => { if (editor.isEditable) updateAttributes({ emoji: event.target.value }); }} />
        <div>{["💡", "📌", "✅", "⚠️", "📝", "💬"].map(emoji => <Button key={emoji} variant="ghost" size="icon-xs" onClick={() => { if (editor.isEditable) updateAttributes({ emoji }); }}>{emoji}</Button>)}</div>
      </PopoverContent>
    </Popover></div><NodeViewContent />
  </NodeViewWrapper>;
}
export const Callout = Node.create({
  name: "callout", group: "block", content: "block+", defining: true,
  addAttributes() { return { emoji: { default: "💡", parseHTML: element => element.getAttribute("data-emoji"), renderHTML: attrs => ({ "data-emoji": attrs.emoji }) } }; },
  parseHTML() { return [{ tag: 'aside[data-type="callout"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["aside", { ...HTMLAttributes, "data-type": "callout" }, 0]; },
  ...createBlockMarkdownSpec({ nodeName: "callout", allowedAttributes: ["emoji", "textColor", "backgroundColor"] }),
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});

function ToggleView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const editable = useEditorState({ editor, selector: ({ editor }) => editor.isEditable });
  const [readOpen, setReadOpen] = useState(Boolean(node.attrs.open));
  useEffect(() => setReadOpen(Boolean(node.attrs.open)), [node.attrs.open]);
  const open = editable ? Boolean(node.attrs.open) : readOpen;
  return <NodeViewWrapper data-type="details" data-open={open ? "true" : "false"}
    style={{ color: node.attrs.textColor, backgroundColor: node.attrs.backgroundColor }}>
    <Button variant="ghost" size="icon-xs" contentEditable={false} aria-label={open ? "Collapse toggle" : "Expand toggle"}
      aria-expanded={open} onClick={() => { if (editor.isEditable) updateAttributes({ open: !open }); else setReadOpen(!open); }}><ChevronRight size="0.9375rem" /></Button>
    <NodeViewContent />
  </NodeViewWrapper>;
}
export const NoteDetails = Details.extend({
  addNodeView() { return ReactNodeViewRenderer(ToggleView); },
}).configure({ persist: true });
export const NoteDetailsContent = DetailsContent.extend({
  addNodeView() { return () => { const dom = document.createElement("div"); dom.dataset.type = "detailsContent"; return { dom, contentDOM: dom }; }; },
});
export const NoteDetailsSummary = DetailsSummary.extend({
  content: "inline*",
  addAttributes() {
    return { level: { default: 0, parseHTML: element => Number(element.getAttribute("data-level")) || 0,
      renderHTML: attrs => ({ "data-level": attrs.level }) } };
  },
});

export function noteHeadings(editor: Editor) {
  const headings: { title: string; level: number; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" || (node.type.name === "detailsSummary" && node.attrs.level))
      headings.push({ title: node.textContent || "Untitled heading", level: node.attrs.level, pos });
  });
  return headings;
}
export function jumpToHeading(editor: Editor, pos: number) {
  const element = editor.view.nodeDOM(pos);
  if (element instanceof HTMLElement) element.scrollIntoView({ block: "center", behavior: "smooth" });
  if (editor.isEditable) editor.commands.setTextSelection(pos + 1);
}
function ContentsView({ editor }: ReactNodeViewProps) {
  const headings = useEditorState({ editor, selector: ({ editor }) => noteHeadings(editor) });
  return <NodeViewWrapper className="note-contents" contentEditable={false} data-type="tableOfContents">
    <span className="group-label">Table of contents</span>
    {headings.length ? headings.map(heading => <Button variant="ghost" size="xs" key={heading.pos} onClick={() => jumpToHeading(editor, heading.pos)}
      style={{ paddingLeft: `${(heading.level - 1) * 0.75 + 0.25}rem` }}>{heading.title}</Button>) : <p className="muted">Add headings to build your contents.</p>}
  </NodeViewWrapper>;
}
export const TableOfContents = Node.create({
  name: "tableOfContents", group: "block", atom: true,
  parseHTML() { return [{ tag: 'nav[data-type="tableOfContents"]' }]; },
  renderHTML() { return ["nav", { "data-type": "tableOfContents" }, "Table of contents"]; },
  ...createBlockMarkdownSpec({ nodeName: "tableOfContents" }),
  addNodeView() { return ReactNodeViewRenderer(ContentsView); },
});
