import {
  BridgeExtension,
  TenTapStartKit,
  useTenTap,
  EditorContent,
  sendMessage,
  LinkBridge,
} from "@10play/tentap-editor/web";
import { Node, Extension, createBlockMarkdownSpec } from "@tiptap/core";
import CodeBlock from "@tiptap/extension-code-block";
import { BackgroundColor } from "@tiptap/extension-text-style";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { createRoot } from "react-dom/client";

const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      emoji: {
        default: "💡",
        parseHTML: (element) => element.getAttribute("data-emoji"),
        renderHTML: (attrs) => ({ "data-emoji": attrs.emoji }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["aside", { ...HTMLAttributes, "data-type": "callout" }, 0];
  },
  ...createBlockMarkdownSpec({
    nodeName: "callout",
    allowedAttributes: ["emoji", "textColor", "backgroundColor"],
  }),
});
const Contents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: 'nav[data-type="tableOfContents"]' }];
  },
  renderHTML() {
    return ["nav", { "data-type": "tableOfContents" }, "Table of contents"];
  },
  ...createBlockMarkdownSpec({ nodeName: "tableOfContents" }),
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement("nav");
      dom.dataset.type = "tableOfContents";
      dom.contentEditable = "false";
      const render = () => {
        dom.replaceChildren();
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== "heading") return;
          const button = document.createElement("button");
          button.textContent = node.textContent;
          button.onclick = () => {
            editor.view.nodeDOM(pos)?.scrollIntoView({ block: "center" });
          };
          dom.append(button);
        });
      };
      render();
      editor.on("update", render);
      return {
        dom,
        update: () => {
          render();
          return true;
        },
        destroy: () => editor.off("update", render),
      };
    };
  },
});
const Formatting = Extension.create({
  name: "dockFormatting",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "codeBlock",
          "callout",
          "details",
          "table",
          "bulletList",
          "orderedList",
          "taskList",
          "horizontalRule",
        ],
        attributes: {
          textColor: {
            default: null,
            parseHTML: (element) => element.style.color || null,
            renderHTML: (attrs) =>
              attrs.textColor ? { style: `color:${attrs.textColor}` } : {},
          },
          backgroundColor: {
            default: null,
            parseHTML: (element) => element.style.backgroundColor || null,
            renderHTML: (attrs) =>
              attrs.backgroundColor
                ? { style: `background-color:${attrs.backgroundColor}` }
                : {},
          },
        },
      },
    ];
  },
});
let lastSelection: { from: number; to: number } | undefined;
const dockBridge = new BridgeExtension({
  forceName: "dockFormatting",
  tiptapExtension: Formatting,
  tiptapExtensionDeps: [
    CodeBlock,
    HorizontalRule,
    BackgroundColor,
    Markdown.configure({ markedOptions: { breaks: true } }),
    Callout,
    Details.configure({ persist: true }),
    DetailsContent,
    DetailsSummary.extend({
      addAttributes() {
        return {
          level: {
            default: 0,
            parseHTML: (element) =>
              Number(element.getAttribute("data-level")) || 0,
            renderHTML: (attrs) => ({ "data-level": attrs.level }),
          },
        };
      },
    }),
    Table.configure({
      resizable: false,
      renderWrapper: true,
      cellMinWidth: 80,
    }),
    TableRow,
    TableHeader,
    TableCell,
    Contents,
  ],
  onBridgeMessage(editor, message) {
    if (message.type !== "dock-format") return false;
    const { action, value } = message.payload;
    if (action === "restoreSelection") {
      if (lastSelection)
        editor.chain().focus().setTextSelection(lastSelection).run();
      return true;
    }
    const chain = editor.chain().focus();
    if (action === "heading")
      chain.toggleHeading({ level: Number(value) }).run();
    if (action === "code") chain.toggleCodeBlock().run();
    if (action === "divider") chain.setHorizontalRule().run();
    if (action === "quote") chain.toggleBlockquote().run();
    if (action === "table")
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    if (action === "callout")
      chain
        .insertContent({ type: "callout", content: [{ type: "paragraph" }] })
        .run();
    if (action === "toggle")
      chain
        .insertContent({
          type: "details",
          attrs: { open: true },
          content: [
            {
              type: "detailsSummary",
              content: [{ type: "text", text: value }],
            },
            { type: "detailsContent", content: [{ type: "paragraph" }] },
          ],
        })
        .run();
    if (action === "contents")
      chain.insertContent({ type: "tableOfContents" }).run();
    if (action === "textColor" || action === "backgroundColor")
      chain
        .updateAttributes(
          editor.isActive("heading") ? "heading" : "paragraph",
          { [action]: value || null },
        )
        .run();
    if (action === "source")
      editor.commands.setContent(value, { contentType: "markdown" });
    if (["duplicate", "moveUp", "moveDown"].includes(action)) {
      const { $from } = editor.state.selection;
      if ($from.depth < 1) return true;
      const node = $from.node(1),
        from = $from.before(1),
        to = from + node.nodeSize;
      if (action === "duplicate")
        chain.insertContentAt(to, node.toJSON()).run();
      else {
        const blocks = [];
        editor.state.doc.forEach((node, position) =>
          blocks.push({ node, position }),
        );
        const index = blocks.findIndex((block) => block.position === from),
          other = blocks[index + (action === "moveUp" ? -1 : 1)];
        if (!other) return true;
        const destination =
          action === "moveUp"
            ? other.position
            : other.position + other.node.nodeSize;
        const tr = editor.state.tr.delete(from, to);
        tr.insert(tr.mapping.map(destination), node);
        editor.view.dispatch(tr);
      }
    }
    return true;
  },
});
function NoteEditor() {
  const editor = useTenTap({
    bridges: [
      ...TenTapStartKit.filter((bridge) => bridge.name !== LinkBridge.name),
      LinkBridge.configureExtension({
        protocols: ["dock-note"],
        openOnClick: false,
      }),
      dockBridge,
    ],
    tiptapOptions: {
      content: window.initialContent || "",
      contentType: "markdown",
      onSelectionUpdate: ({ editor }) => {
        if (editor.isFocused)
          lastSelection = {
            from: editor.state.selection.from,
            to: editor.state.selection.to,
          };
      },
      editorProps: {
        handleClick: (_view, _pos, event) => {
          const anchor = (event.target as HTMLElement).closest("a");
          if (!anchor) return false;
          event.preventDefault();
          sendMessage({
            type: "dock-link",
            payload: { url: anchor.getAttribute("href") ?? "" },
          });
          return true;
        },
        attributes: {
          role: "textbox",
          "aria-label": "Note body",
          "aria-multiline": "true",
        },
      },
    },
  });
  return <EditorContent editor={editor} />;
}
const wait = setInterval(() => {
  if (!window.contentInjected) return;
  clearInterval(wait);
  createRoot(document.getElementById("root")!).render(<NoteEditor />);
}, 5);
