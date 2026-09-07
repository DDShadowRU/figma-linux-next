---
name: figma-mcp-driving
description: |
  Operate the LIVE figma-linux-next app through its two MCP surfaces — the built-in Figma MCP (HTTP on
  127.0.0.1:<serverPort>, default 3845; tools addressed by fileKey, files opened in hidden mcp tabs) and
  chrome-figma (Chrome DevTools Protocol) as the control plane that drives the app window. Use this
  skill whenever a task means working with a real Figma file through the running app: reading a file
  by key, checking what the app did with an mcp tab, driving or screenshotting the window, or
  debugging why a tool call timed out. Trigger it even when the user doesn't name the MCPs — any
  "drive Figma", "look at this file", "why does get_design hang" request in this app belongs here.
---

# Driving figma-linux-next with two MCPs

| | **Figma MCP** (HTTP :3845) | **chrome-figma** (CDP) |
|---|---|---|
| Plane | **Data** — Figma files by `fileKey` | **Control** — the app window |
| Transport | Streamable HTTP, `POST /mcp` (any MCP client, curl) | `mcp__chrome-figma__*` via `--remote-debugging-port` |
| Operates on | a file, opened by the app in its own hidden mcp tab | any CDP page: panel, tabs, modals |

**The Figma MCP does not follow the active tab.** Every tool takes a `fileKey` (the id in
`figma.com/design/<fileKey>/…`). The app opens the file in a background tab that the tab strip does
not list, waits until Figma's Plugin API answers, and keeps that tab for later calls — from any
client. The plug button with a count on the right of the panel lists them; its native menu shows one or
closes them all. Your own tabs are separate: the user opening the same file gets another tab, and the user's
open-file flow never lands in an mcp tab. Close an mcp tab and the next call reopens it. mcp tabs are
never restored on restart and never appear in "reopen closed tab".

## Preconditions

- **Figma MCP** — on by default: Settings → *MCP integrations* → **Enable Figma MCP**. Applies live
  (start/stop/rebind the server on save). The port is `mcp.serverPort`; read it from the *Server
  port* field. Health check (a 200 with `serverInfo` means it's up):
  ```
  curl -s -X POST http://127.0.0.1:3845/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}'
  ```
- **chrome-figma** — needs **Enable Chrome DevTools (CDP)** *and an app restart* (launch flag).
  Until then port 9222 is closed and every `mcp__chrome-figma__*` call fails; a client showing
  "connected" only means the npx process started. Verify: `curl -s http://127.0.0.1:9222/json/version`.
  For a dev build, `bunx electron dist/main/main.js --remote-debugging-port=9222` works without
  touching settings.

## Recipes

**Open a file** — every tool takes a `fileKey`, and the first call on a file takes ~5–10 s (tab
opens and Figma boots); later calls answer in well under a second. Where to get a key: the URL the
user gave you, or `fetch('/api/recent_files')` evaluated in the Recents page over CDP (`"key"` fields).

**Read a design** — `get_design({ fileKey, nodeId })`. The text block is a Framelink-style tree:
`GLOBAL_VARS` (shared styles, keyed by Figma style name or a content hash), `ELEMENTS` (repeated
node bodies referenced as `template=EL-…`), `COMPONENTS`, then `NODES` with one line per node —
`[TYPE] "name" #id layout=… fills=… text=…`, two spaces per level. Paints are listed top layer
first, which the trailing notes say out loud. `IMAGE-SVG` is a vector container collapsed to one
node; its `fills`/`strokes` are the unique colours of the vectors inside — one value means the icon
can be tinted, a list means it carries fixed colours — and the shapes themselves come from
`download_assets(svg)`. A fill that carries an `imageRef` is a
photo the designer uploaded — pull the original with `download_image_fills`, **not**
`download_assets`, which re-renders the node with its text and children on top of the photo. A big node is cut by depth to fit ~64 KB: a node whose subtree was left
out ends its line with `children=…` (request it by id to read inside) and the text ends with a
`TRUNCATED: …` note. The reply is one text block, no JSON. `depth` exists but is for explicit
requests only. A whole 14-level page renders in about a second; a hidden node, `0:0` and an
unknown id are errors, an orphaned main component (deleted from the canvas) comes back childless.

**Look at a node** — `get_screenshot({ fileKey, nodeId, scale? })`. The PNG arrives as an image
block; the JSON next to it carries `node` (design px), `image` (px) and `scale` between them — use
`scale` when measuring on the picture. `scale` defaults to 1 (design px, so a 24 px icon comes back
24 px) and goes up to 4 when you need to read detail; it is never raised for you, only lowered — the
longest edge is capped at 2000 px, so ask for 4 on a wide section and the reply reports the smaller
scale it actually rendered. Node ids: `1015:50826`, the URL form `1015-50826` (`node-id=…`), or an
instance child `I5752:65667;469:26400`. Pages export too (`1015:50826` above is one) but are large
and slow; prefer a frame or section. An icon takes well under a second, a 14 000-px section ~5 s.

**Pull assets into a project** — `download_assets({ fileKey, nodes: [nodeId, …], format?, scale? })`,
up to 20 nodes per call, one format (png/jpg/svg) and scale for all of them. Each file comes back with its absolute path (under
`<temp>/figma-mcp-assets/<callId>/`); the directory is wiped on the next app start, so copy
what you need right away. The reply is paths only — read a file the ordinary way when you need its
bytes. One bad node lands in `failed`, the rest are still written. For
icons ask for `svg`: the markup is minified (svgo `preset-default`, ids not renamed) and comes with
`width`, `height` and `viewBox`, Figma's `clip0_…` ids, flat `<path>`s in relative commands rounded to
3 decimals and the fills Figma had; adapting colours to the project is your job.

**Pull a photo out of a frame** — `download_image_fills({ fileKey, nodes: [nodeId, …] })`, up to 20
nodes, one file per IMAGE fill, written next to the `download_assets` files. The bytes are the
upload, so the extension tells you what the designer actually
gave Figma (a `.webp` will not open everywhere); png, jpg and webp are written, anything else lands
in `failed`. Nothing is cropped: `scaleMode` in the tree says how the design places it (`FILL` =
CSS `object-fit: cover`, nothing to do), and an `imageTransform` in the reply means there *is* a
crop — `left = t[0][2]*width, top = t[1][2]*height, w = t[0][0]*width, h = t[1][1]*height`, clamped
into the image (`magick in.jpg -crop WxH+L+T out.jpg`). Match a file to a tree line by `imageRef`,
never by position in `fills=[…]`.

**Check what the app did** — chrome-figma `list_pages`; the panel is the `dist/index.html` page.
Evaluate `[...document.querySelectorAll('[data-tab-id]')].map(e => e.innerText)` there to see the
user's tab strip (mcp tabs are not in it) and
`document.querySelector('[data-mcp-tabs]')?.dataset.mcpTabs` for the comma-separated ids of the open
mcp tabs (the element is absent when there are none; its `title` lists the file names). Page ids in
CDP are **not** tab ids: match by URL.

**Drive the UI** — from the panel page, `window.figmaApi.send('setTabFocus', <data-tab-id>)`,
`send('setFocusToMainTab')`, `send('closeTab', <id>)`. The same calls take an mcp tab id from
`data-mcp-tabs`: focusing one shows it full-size like any tab; leaving it parks it again and the
Figma MCP keeps working.

**Debug a failed call** — read the error text before anything else:
- *Figma answered 404* / *403* → wrong key, deleted file, or the account has no access. These fail
  within a couple of seconds and the app closes the tab it opened; nothing to retry.
- *Node "…" not found in file …* → the id is from another file, or mistyped. Dashes are normalised
  to colons for you (the message shows the normalised id); `0:0` is the document and cannot be
  exported. *is hidden (visible: false)* → the layer is switched off in the design; Figma renders
  nothing for it, so pick a visible node.
- *has no image fill* → the node is a shape or a group; find the node whose `fills=` entry carries
  the `imageRef`. *all hidden (visible: false)* → the fill is switched off in the design. *has a
  video fill* → Figma keeps no downloadable original, use `get_screenshot`.
- url still `/login` → the app isn't signed in.
- a timeout carries the tab's state: url, `visibility`, `readyState`, size, page title and the
  first lines of page text.
- `visibility: hidden` → something covers the parked tab (settings or changelog modal open, or a
  regression in `Window.mountMcpTab`). Close the modal and retry; the session re-probes by itself.
- an empty timeout from the client, or a call that felt slow → the app log,
  `~/.config/figma-linux-next/logs/figma-linux-next.log`. `grep '\[mcp\]'` gives one line per tool
  call (`get_design <fileKey> node=… 12480ms ok`, or the error code and message instead of `ok`),
  one `Plugin API ready in …s` counted from the tab opening, and the tab's open/close lines. That is
  the whole instrumentation — nothing times an individual node.

## Gotchas

- **Plugin API needs a visible view.** Figma only initializes `window.figma` in a visible document,
  and Chromium hides a `WebContentsView` that is detached *or* fully covered by a sibling view. That
  is why unfocused mcp tabs are parked at 1×1 px in the panel strip instead of detached — see the
  gotcha in `CLAUDE.md`. Don't "optimize" it away.
- **Timeout is 45 s** (`FIGMA_MCP_FILE_OPEN_TIMEOUT_MS` overrides it for experiments), kept under
  the 60 s an MCP client gives a call: past that the agent gets the transport's empty "operation
  timed out" instead of our error with the tab state. A large file can need most of it on first
  open; the tab keeps loading after the error, so a retry usually lands.
- **Stateless server.** There is no MCP session to keep; the file registry is process-wide, so two
  agents asking for one `fileKey` share one tab and one wait.
- **`serverInfo.version`** is the app version from `package.json`.

## Tool quick-reference

**Figma MCP:** `get_design({ fileKey, nodeId, depth? }) → text tree (cut nodes marked children=…)`;
`get_screenshot({ fileKey, nodeId, scale? }) → image + { node, image, scale }`;
`download_assets({ fileKey, nodes[], format?, scale? }) → { files[{ nodeId, name, path, width, height }], failed[] }`;
`download_image_fills({ fileKey, nodes[] }) → { images[{ nodeId, name, imageRef, path, width, height, imageTransform? }], failed[] }`.
Every tool takes `fileKey` the same way.

**chrome-figma (control):** `list_pages` / `select_page`, `evaluate_script`, `take_screenshot` /
`take_snapshot`, `click` / `fill` / `type_text` / `press_key`, `list_console_messages`,
`list_network_requests`.

For app architecture (tabs, windows, IPC) load the **figma-linux-next** skill; the MCP code lives in
`src/main/MCP/` (`McpService` → `McpHttpServer` + `McpFileRegistry`/`McpFileSession` → tools).
