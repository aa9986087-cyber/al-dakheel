// Builds dist/preview.html: one self-contained page (no server) where you play against computer players.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const localNet = root + "preview/local-net.js";

const out = await build({
  entryPoints: [root + "preview/entry.js"],
  bundle: true, format: "iife", minify: true, write: false, target: "es2020",
  plugins: [{
    name: "offline-net",
    setup(b) {
      b.onResolve({ filter: /^\.\/net\.js$/ }, (args) => (args.importer.includes("public/client") ? { path: localNet } : undefined));
    }
  }]
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const icon = "data:image/svg+xml;base64," + Buffer.from(await readFile(root + "public/icon.svg")).toString("base64");
let css = (await readFile(root + "public/style.css", "utf8")).replace(/url\("icon\.svg"\)/g, `url("${icon}")`);
css += `
.preview-note { background: rgba(212,162,76,.12); border: 1px dashed var(--line); border-radius: 12px; padding: 8px 10px; font-size: .9rem; line-height: 1.6; color: var(--sand); }
.preview-box { margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 8px; display: grid; gap: 6px; }
.role-pick { display: flex; gap: 4px; }
.role-pick button { border: 1px solid var(--line); background: #2a1a11; border-radius: 8px; padding: 4px 9px; cursor: pointer; font-weight: 700; }
.role-pick button.sel { background: var(--gold); color: #2a1709; }
`;
const html = await readFile(root + "public/index.html", "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"))
  .replace(/<script type="module"[^>]*><\/script>/, "");
const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];

const page = `<title>الدخيل — طائرة الصقر</title>
<meta name="theme-color" content="#140d0a">
<link rel="icon" href="${icon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>${css}</style>
<div dir="rtl" lang="ar">${body}</div>
<script>${js}</script>
`;
await mkdir(root + "dist", { recursive: true });
await writeFile(root + "dist/preview.html", page);
console.log(`dist/preview.html ${(page.length / 1024).toFixed(0)} KB`);
