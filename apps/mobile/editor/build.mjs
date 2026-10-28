import { mkdirSync, writeFileSync, realpathSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobile = createRequire(resolve(root, "package.json"));
const desktop = createRequire(resolve(root, "../desktop/package.json"));
const { build } = desktop("vite");
const result = await build({
  configFile: false,
  root,
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      react: dirname(mobile.resolve("react/package.json")),
      "react-dom": dirname(mobile.resolve("react-dom/package.json")),
      "@10play/tentap-editor/web": resolve(
        dirname(
          realpathSync(mobile.resolve("@10play/tentap-editor/package.json")),
        ),
        "src/webEditorUtils/index.ts",
      ),
    },
  },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    write: false,
    lib: {
      entry: resolve(root, "editor/index.tsx"),
      formats: ["iife"],
      name: "DockNoteEditor",
    },
  },
});
const bundle = (Array.isArray(result) ? result[0] : result).output
  .find((output) => output.type === "chunk")
  .code.replace(/<\/script/gi, "<\\/script");
const notePalettes = readFileSync(
  resolve(root, "../desktop/src/renderer/src/styles.css"),
  "utf8",
).match(/:root(?:\[data-theme="light"\])? \{\s*--note-color-gray:[^}]+\}/g);
if (notePalettes?.length !== 2)
  throw new Error("Desktop note palettes changed; update the editor build.");
const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:"><style>${notePalettes.join("\n")}body{margin:0;font:16px/1.6 system-ui}.tiptap{padding:16px;outline:none;min-height:300px}img{max-width:100%}table{border-collapse:collapse;min-width:100%}td,th{border:1px solid currentColor;min-width:60px;padding:8px}aside,blockquote,nav[data-type]{border-inline-start:3px solid currentColor;padding:12px;margin:12px 0}nav button{display:block;color:inherit;background:transparent;border:0;padding:12px;text-align:start}div[data-type=details]{border:1px solid currentColor;padding:12px}pre{white-space:pre-wrap}ul[data-type=taskList]{list-style:none;padding-inline-start:0}ul[data-type=taskList] li{display:flex;gap:8px}a{color:inherit;text-decoration:underline}</style></head><body><div id="root"></div><script>${bundle}</script></body></html>`;
mkdirSync(resolve(root, ".generated"), { recursive: true });
writeFileSync(
  resolve(root, ".generated/dock-editor.ts"),
  "export const dockEditorHtml = " + JSON.stringify(html) + ";\n",
);
