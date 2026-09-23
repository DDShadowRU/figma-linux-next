# CLAUDE.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

figma-linux-next is a fork of the unofficial Electron-based Figma desktop app for Linux. It provides native Wayland support, GPU acceleration, system integration, extensions, and advanced window management.

## Development Commands

### Building & Running

```bash
# Install dependencies
bun install

# Development mode (builds main, watches renderer with hot reload)
bun run dev

# Build for production
bun run build

# Run built production version
bun run start

# Run in watch mode (restarts on file changes)
bun run run:watch
```

### Build System

The project uses **Vite** with `vite-plugin-electron`:
- `vite.config.mts` - Unified build config for main + renderer processes

Build outputs to `dist/`:
- `dist/main/main.js` - Main process entry point
- `dist/renderer/` - UI bundles (Panel + Settings)

### Packaging

```bash
# Package for all configured formats (deb, rpm, pacman, AppImage, zip)
bun run package

# Build and create installers (includes AppImageTool dependency)
bun run pack

# Install locally to /opt/figma-linux-next for testing
bun run local:install

# Build with electron-builder
bun run builder
```

Build targets configured in [`config/builder.json`](config/builder.json):
- deb (x64, arm64)
- rpm (x64, arm64)
- pacman (x64)
- AppImage (x64, arm64)
- zip (x64, arm64)

### Code Quality

```bash
# Lint + format .ts in place (Biome)
bun run lp

# Lint check only — no writes (used by CI)
bun run lint

# Svelte type checking
bun run check

# Svelte 5 rune antipatterns in a single component (no install needed)
bunx @sveltejs/mcp svelte-autofixer src/renderer/Panel/App.svelte

# Pre-commit hook (runs Biome on staged files via lint-staged)
bun run precommit
```

Linting/formatting: **Biome** (`biome.json`) for all `.ts` (src + tests) — formatter matches the
former Prettier (100 cols, double quotes, semicolons, trailing-all); `noExplicitAny` and
`noNonNullAssertion` are disabled to match project conventions; `*.d.ts` has a small rule carve-out.
`.svelte` files are not linted/formatted — only `svelte-check` (Biome doesn't parse Svelte 5 runes
yet). ESLint and Prettier were removed in favor of Biome.

`svelte-check` covers types; rune antipatterns (assignment to `$derived`, unguarded `bind:this` in
`$effect`, leftover `on:click`) slip through it. `bunx @sveltejs/mcp svelte-autofixer <file>` catches
those — one file per invocation, not wired into any script. Runs from the bunx cache and leaves
`bun.lock` untouched.

### Testing

```bash
# Unit tests
bun run test:unit

# E2E tests (Playwright)
bun run test:e2e
```

Unit tests live next to source files (`*.test.ts`). E2E tests are in `tests/e2e/`.

`bunfig.toml` registers `tests/unit/electron-preload.ts` as a test preload — globally mocks the `electron` module so unit tests touching `src/utils/Main/` work without an Electron runtime.

## Architecture

### Process Architecture

The application is a classic Electron app with two processes:

**Main Process** (`src/main/`) - Node.js backend that manages:
- Windows and tabs (WindowManager, Window, TabManager)
- Extensions/plugins (ExtensionManager)
- Figma session authentication (Session)
- System fonts (FontManager)
- Persistent settings (Storage)
- Dialogs (Native or Zenity backends)
- MCP server for AI assistant integration (McpService)

**Renderer Process** (`src/renderer/`) - Browser frontend with two Svelte apps:
- **Panel** (`src/renderer/Panel/`) - Top toolbar UI with tabs
- **Settings** (`src/renderer/Settings/`) - Settings modal

Communication between processes goes through a typed **preload bridge** (`src/main/preload/bridge.ts`) that exposes `window.figmaApi` — direct `ipcRenderer` usage in renderers is not allowed.

### Main Process Structure

Entry point: `src/main/index.ts` initializes storage and dialogs, then instantiates App:

```typescript
new App(new WindowManager(), new Session(), new FontManager());
```

`ExtensionManager` is instantiated separately, not passed to App.

**App class** (`src/main/App.ts`):
- Acquires single-instance lock
- Applies Chromium command-line switches (GPU acceleration, Wayland, VAAPI)
- Instantiates all IPC controllers and seals the registry
- Registers `figma://` protocol handler and starts the MCP server
- Manages lifecycle events (ready, second-instance, window-all-closed)

**IpcRegistry** (`src/main/controllers/registry.ts`):
- Central registry for all IPC handlers — replaces direct `ipcMain` calls
- `ipcRegistry.on(channel, handler, source)` / `ipcRegistry.handle(channel, handler, source)`
- `ipcRegistry.seal()` called after all controllers register — throws on duplicate or post-seal registration
- **Always use `ipcRegistry` instead of `ipcMain` directly** for new IPC handlers

**Controllers** (`src/main/controllers/`):
- `SettingsController` — settings get/set, frame style, scaling, export dir
- `FontController` — font enumeration and file serving
- `ClipboardController` — clipboard writes (images, SVG, PDF)
- `AuthController` — login, logout, app auth flow
- `FileController` — file creation and export

**WindowManager** (`src/main/Ui/WindowManager.ts`):
- Maintains Map of all Window instances (keyed by window ID)
- Tracks last focused window
- Restores/saves window state from settings
- Handles protocol URLs (`figma://` links)
- Manages closed tabs history

**Window** (`src/main/Ui/Window.ts`):
- Wraps a `BrowserWindow` with a `TabManager`, a `SettingsView` and a lazily created `TabPreviewView`
  (the hover card, `src/main/Ui/TabPreviewView.ts` + `src/renderer/Preview/`)
- Child views (tabs, the hover card, the Settings / What's New overlays) are attached to the
  `BrowserWindow` once and switched with `view.setVisible()`; `swapTo()` shows the next tab and
  hides the previous one. See the gotcha "Child views are attached once" below.
- Maintains a **warm tab**: a pre-loaded new-file `Tab` kept in the background for instant opening (TTL: 5 minutes), attached hidden from creation so promoting it is a plain `setVisible(true)`. Pre-warming happens after a file tab is opened.

**TabManager** (`src/main/Ui/TabManager.ts`):
- Per-window tab management
- Three tab types: `MainTab` (always present), regular `Tab`s, `CommunityTab`
- Each tab is a `WebContentsView` positioned below the panel
- Only one tab visible at a time

**ExtensionManager** (`src/main/ExtensionManager.ts`):
- Scans `~/.config/figma-linux-next/Extensions/` directory
- File watching with Chokidar for hot-reloading during development
- Observer pattern for manifest and code file changes
- Extensions loaded from `savedExtensions` in settings

**Storage** (`src/main/Storage.ts`):
- Singleton (`storage`) for settings persistence to `~/.config/figma-linux-next/settings.json`
- `storage.initialize()` must be called at startup before App
- Deep-merges saved settings with `DEFAULT_SETTINGS` on load
- IPC registration is in `SettingsController`, not in `storage` itself

**Dialogs** (`src/main/Dialogs/`):
- Provider pattern: Native (Electron dialogs) or Zenity (GTK dialogs)
- `dialogs.switchProvider(useZenity)` switches at runtime; controlled by `settings.app.useZenity`

**MCP Server** (`src/main/MCP/McpService.ts`):
- Built on the official SDK v2: `@modelcontextprotocol/server` (stateless `createMcpHandler`, a fresh
  `McpServer` per request) + `@modelcontextprotocol/node`; Streamable HTTP on port **3845**, loopback only
- Tools are addressed by `fileKey`, never by "the active tab". `McpFileRegistry` opens each file once
  in a tab of its own (`Window.openMcpFile` → `Tab.owner === "mcp"`) and shares it between clients;
  `McpFileSession` waits for `window.figma` and runs scripts via `webContents.executeJavaScript()`
- Tools: `get_design` (one node → text tree, below), `get_screenshot` (one node → PNG image block
  at `scale`, 0.1–4, default 1 = design px; small nodes are **not** upscaled, the scale is only
  lowered — capped so the longest edge stays within `SCREENSHOT_MAX_EDGE`, then halved once
  from the scale actually rendered if the png passes `SCREENSHOT_MAX_BYTES`; the real scale
  comes back next to the image), `download_assets` (up
  to `MAX_ASSET_NODES` nodes → png/jpg/svg files) and `download_image_fills` (below: the images
  stored behind a node's IMAGE fills, untouched). `get_screenshot`/`download_assets` run one in-tab
  script, `buildExportNodesScript()` (`scripts/exportNodes.ts`): it resolves ids with
  `getNodeByIdAsync`, exports sequentially under a time/byte budget and returns base64 or SVG text;
  `tools/exportErrors.ts` turns its per-node error codes (and `exportDesign`'s) into messages
- `get_design({ fileKey, nodeId, depth? })` reuses Framelink's transformer: the npm package
  `figma-developer-mcp` (GLips/Figma-Context-MCP, MIT) is an **exact-pinned devDependency** that
  Rollup inlines into `main.js` (it is not in `rollupOptions.external`, so it never reaches
  `src/package.json` or `dist/node_modules`; `flatpak/package.json` mirrors the pin because the
  Flatpak build runs `vite build` offline). `scripts/exportDesign.ts` gets a REST-shaped node from
  the tab via `node.exportAsync({ format: "JSON_REST_V1" })` (page loaded first; an orphaned main
  component exports with no children — a Figma limitation), prunes children below `depth` in-tab
  and caps the raw JSON at `DESIGN_RAW_MAX_BYTES`; `design/simplify.ts` runs
  `simplifyRawFigmaObject` + `collapseSvgContainers` and `tidyDesign()` strips Framelink's
  `imageDownloadArguments` (the crop and file-name plan for its own REST image tool) and `gifRef`
  (nothing here downloads gifs), empty values and opacity float noise — but keeps `imageRef`, the
  id `download_image_fills` takes. It also drops the components no node in the output points at:
  Figma hands over the component map of the whole exported subtree, so the table listed the
  components behind a button's switched-off icons and an agent had no way to place them. Kept are
  the ids reachable through a `componentId` on a node **or in an `ELEMENTS` body** (a templated
  node keeps nothing but `id`, `name` and `template`), and the component sets those components
  name. A fill can end up inline on the node line, in `GLOBAL_VARS` (used
  ≥2× or a named Figma style) or inside an `ELEMENTS` body;
  `design/serializeTree.ts` is our own renderer of Framelink's `tree` format (`[TYPE] "name" #id
  key=value…`, shared `GLOBAL_VARS`/`ELEMENTS` tables) because the package doesn't export its
  serializers. Output over `DESIGN_MAX_OUTPUT_BYTES` is cut by depth (binary search on the deepest
  level that fits): every node whose children were left out gets `children=…` on its line and the
  text ends with a one-line `TRUNCATED:` note. The reply is that single text block — no
  `outputSchema`, so `runTool` skips its JSON tail when a tool returns no `output` (the
  description is one sentence, like Framelink's). Variables (`boundVariables` → names) and
  Plugin-API named styles are deliberately not wired yet
- Framelink formats every line-height unit but Figma's Auto (`lineHeightUnit: "INTRINSIC_%"`),
  which it drops — so agents guessed the leading or read the neighbouring `paragraphSpacing` as
  one. The absence is named rather than filled: `designFlags()` (`design/simplify.ts`) reports in
  one walk whether the output holds a text style with no `lineHeight`, and `getDesign` turns that into
  `Text styles: no lineHeight = Figma Auto (line-height: normal)`, passed to `serializeTree` in
  the same `notes` list as `TRUNCATED:` — the renderer only prints trailing sections, it does not
  compose them, and `TRUNCATED:` stays last because it is the actionable one. Styles are reached
  through the `textStyle` that references them, never by scanning `globalVars`: the character-run
  deltas parked there (`ts1`, `ts2`, …) are partial styles with no line height of their own, and
  sniffing them for font keys reported Auto in files that had none. A tree of icons carries no
  note at all. Resolving Auto to `lineHeightPx` instead was built and rejected: Auto **is**
  `line-height: normal`, and pinning the font's current metrics into the output makes a value that
  silently stops being true when the font changes
- Framelink `.reverse()`s every paint array into CSS order and says so nowhere, so agents guessed
  which layer was on top; one read a card's photo as sitting under a 60% black veil and brightened
  it 2.5×. The same `designFlags()` walk reports whether any paint reached the output and
  `getDesign` turns that into `Fills and strokes: top layer first (CSS order)`, another entry in
  the same `notes` list
- `collapseSvgContainers` turns an icon's frame into one `IMAGE-SVG` node and drops the vectors —
  along with the only place the icon's colour lived, since the frame itself usually has none. The
  agent needs it while reading the tree, to tell an icon it should tint from the theme
  (`currentColor`, `tint`) from one carrying a fixed colour; until now that meant downloading every
  svg, and nobody downloaded the status bar. `design/svgColors.ts` wraps the package's hook — an
  extractor next to it captures `globalVars` because `afterChildren` is handed no context — and when
  it collapses, `keepSvgColors()` moves the unique paints of the vectors onto the node **in the
  same `fills`/`strokes` fields**: the package counts style references only in those fields and
  only as strings, so one reference covering the whole set stays a reference (the icon reads
  `strokes=Primary/Main` like any other node) while a mix has to be resolved to values, capped at
  `SVG_COLORS_MAX` with a trailing `"…"` — past that the agent goes to `download_assets` anyway. A
  field of our own (`svgColors=`) was not an option for the same counting reason: the key would
  lose its last reference and vanish from `GLOBAL_VARS`, leaving a dangling name. A
  `BOOLEAN_OPERATION` is not descended into: it renders as one shape painted with its own fills,
  and its operands keep the black they were drawn in — collecting those reported `#000000` on
  status-bar icons whose svg has no black in it. Because these are colours standing side by side
  and not a stack, a third `designFlags()` flag adds a second note, `IMAGE-SVG: fills and strokes
  are the unique colors inside the collapsed vector`
- `rootLayout.ts` is an extractor appended to `allExtractors` that rewrites the layout of the
  parentless node, putting the result back on the node **inline** rather than under a key of our
  own — `globalVars` is the package's namespace and its own dedup memo, and a style used once is
  what it inlines anyway. Framelink
  builds `dimensions` for children only and renames a root's fixed axis `contextual` with the size
  moved into `designedWidth`/`designedHeight`, so the requested node was described in words no
  child uses and a canvas frame reported no size at all. The root now always carries `dimensions`
  from its bounding box — there is no parent to resolve `fill`/`hug` against — and `contextual`,
  `designedWidth` and `designedHeight` no longer occur anywhere in the output. Running as an
  extractor puts this before the package's own style dedup/inline/`ELEMENTS` pass, so writing a
  fresh key is enough: the abandoned one loses its last reference and is dropped
- Framelink's linear gradients were wrong in two ways: it maps the handles in 0..1 box space,
  so the angle ignores the aspect ratio (Figma's corner-to-corner diagonal on 891×91 came out
  `135deg`, it is `174.2deg`), and a stop lying outside the box is clamped to 0%/100% **with its own
  colour** — handles reaching past the edge made agents start a banner at `#E84A4A` when its left
  edge is `#743442`. `linearGradient.ts` is another appended extractor that recomputes every
  visible `GRADIENT_LINEAR` fill/stroke from the node size: the gradient is affine, so `t` is
  linear in pixels, the CSS angle is the normal to the third handle's direction, and CSS 0%/100%
  are the lowest/highest `t` over the four corners; out-of-box stops are replaced by the colour
  interpolated at the edge. Angle and positions keep one decimal (integers were off by up to 80/255
  on small handles). The value now depends on the size, so a named style can have several: the
  first keeps its name, the others become `Name (WxH)`; unnamed results get their own
  `fill_<sha1>` key. Unlike `rootLayout.ts` this does write keys into `globalVars`: a gradient
  repeats across nodes and the package's dedup counts only string references, so an inline value
  would never be shared. The file leans on the package's private layout (visible paints mapped
  then reversed, `Name (styleId)` collisions, zero-reference keys dropped) and is redundant once
  upstream (GLips/Figma-Context-MCP) passes the node size to its gradient converter: recheck on
  every bump. Radial/angular/diamond still come straight from the package, radius dropped
- Node ids accept `1015:50826`, the URL form `1015-50826` and instance children `I…;…`.
  `normalizeNodeId()` maps dashes to colons in the tool body, not in zod: a `.transform()` would not
  survive the SDK's JSON-Schema conversion for `tools/list`
- `download_assets` writes through `McpAssetStore` (`assets/`) into
  `<temp>/figma-mcp-assets/<callId>/` (under Flatpak `$XDG_CACHE_HOME/figma-mcp-assets`: the
  sandbox's `/tmp` is invisible to the host). Last session's files are removed on the first export of a
  process (`McpAssetStore.prepare()`), not at start-up: binding the port never waits for the `rm`,
  and `McpService.start()` re-running on a port change from Settings leaves files alone. No `outputDir` parameter by design: the tool never writes outside
  its own directory. The reply of both download tools is their `files`/`images` and `failed` rows
  and nothing else — the absolute path is in there, and nothing is served back over MCP: the client
  opens the file itself instead of spending context on bytes it already has on disk
- svg exports pass through `optimizeSvg()` (`assets/optimizeSvg.ts`): svgo `preset-default` with
  `cleanupIds.minify` off, so Figma ids (`clip0_…`) survive inlining several files into one page.
  svgo is `import()`ed on the first svg export; if it throws, the raw export is written and a
  warning logged. Measured on real files: −40…−55% bytes on vector nodes, ~−25% on frames with
  embedded rasters
- `download_assets` also offers `vector-drawable` (Android VectorDrawable xml) when
  `settings.mcp.androidStudioPath` points at an Android Studio install. The `format` enum and the
  description are built per request in `registerDownloadAssets`, so without a valid path the format
  simply disappears; `assets/vectorDrawable/androidStudio.ts` checks `jbr/bin/java` +
  `plugins/android/lib/sdk-common.jar` and logs an invalid path once per value. Conversion is
  Google's own `Svg2Vector` from `sdk-common.jar`: `convertSvgToVectorDrawable.ts` writes the raw
  Figma svg exports as `<call>/<name>.svg`, drops `Svg2VectorShim.java` (imported via `?raw`) into
  the same dir and runs it once per call in source-launch mode on Studio's JBR (`-cp
  plugins/android/lib/*:lib/*`, ~1 s). The shim leaves `<name>.xml` plus `<name>.log` next to each
  input; the log (Svg2Vector's `ERROR @ line …` / `WARNING @ line …` lines about dropped masks,
  filters, rasters, text) becomes the file's `warning`, and only a missing xml puts the node into
  `failed`. Android resource names (`[a-z0-9_]`, leading letter, `_2` suffixes) come from
  `androidResourceName()` (`tools/fileNames.ts`, shared with `slugify()`/`reserveBaseName()`)
- `download_image_fills({ fileKey, nodes })` answers the one thing `download_assets` cannot: a
  photo used as a node's background, without the node's own text and children rendered on top of
  it. `scripts/exportImageFills.ts` reads `node.fills` in the tab and pulls the stored bytes with
  `figma.getImageByHashAsync(hash).getBytesAsync()` (the sync `getImageByHash` throws in a
  dynamic-page document), under the same `EXPORT_BUDGET` as `exportNodes`. Nothing is re-encoded
  and nothing is cropped: `assets/imageTypes.ts` sniffs the container from the magic bytes
  (png/jpg/webp; anything else is a `failed` row, not a `.bin` file) and the pixel size comes from
  `image.getSizeAsync()` in the tab, because `nativeImage.createFromBuffer()` — what
  `download_assets` uses — returns an empty image for webp. Fills are matched by `imageRef`, never
  by index: the transformer `.reverse()`s fills into CSS order, so an index would not line up with
  `node.fills`. The script returns `{ items, sources }` with the bytes keyed by `imageRef`, so an
  image shared by several fills crosses the `executeJavaScript` boundary, gets decoded and gets
  written exactly once. The reply deliberately carries only what the tree lacks — pixel size and a
  non-identity `imageTransform` (Figma reports an identity matrix on every uncropped fill);
  `scaleMode` and the CSS hints are already in `get_design`. Hidden paints are filtered in the tab,
  so `fills_hidden` is a node error and never a per-fill one. Error vocabularies split at the
  process boundary: `ImageFillError` is what the tab can report, `unsupported_format` is decided
  host-side once the bytes are visible, and only an empty result throws
- Tool descriptions are agent-facing only: inputs, outputs, what is temporary. Internals (parked
  tabs, the Plugin API, fit/scale logic) don't belong in them
- mcp tabs never appear in the panel's tab strip: `Window.addTab()` sends `didTabAdd` only for
  user tabs, and the strip's store drops every later per-tab event (`setTitle`, `setLoading`,
  `setTabType`, mic/voice) for an id it never saw, so nothing else is guarded; only `setTabTitle`
  routes an mcp title to `syncMcpTabs()`. `Window.syncMcpTabs()` sends `setMcpTabs`
  (`{ id, title, busy }[]`, the title starts as the fileKey until Figma reports one) on open, title
  change, close and `frontReady`; the
  panel keeps it in the `mcpTabs` store and `McpIndicator.svelte` renders a plug icon (`Icons/Mcp`)
  with the count on the right of the panel (hidden at 0, `data-mcp-tabs` carries the ids for CDP
  scripts). Its click sends
  `openMcpMenu` → `WindowManager.openMcpMenuHandler` → `MenuManager.openMcpMenuHandler`: a native
  menu with one entry per file (click shows the tab full-size via `setTabFocus`; leaving it re-parks
  it) and `Close all` (through `handleCloseTab`). While a call runs, the button plays a light sweep:
  every tool does its in-tab work through `McpFileRegistry.withFile()`, which wraps it in
  `McpFileSession.whileBusy()` (a depth counter → `McpTabHandle.setBusy()`), `busy` rides in
  `setMcpTabs`, and the indicator keeps the CSS animation until the iteration in flight ends. `focusTab` still
  reaches the panel with the mcp id so no strip tab stays highlighted. Ctrl+(Shift+)Tab and the
  next-tab choice on close only see user tabs (`TabManager.userTabIds`); mcp tabs are also skipped
  by the user's open-file dedup (`Window.findTabForUrl`), by tab persistence (`Window.getState`) and
  by closed-tab history (`WindowManager.handleCloseTab`)
- A parked mcp tab is a live Figma canvas, so `McpFileSession` closes its tab after
  `MCP_TAB_IDLE_TTL_MS` (15 min, `FIGMA_MCP_TAB_IDLE_TTL_MS`) with no tool-initiated work.
  `touch()` restarts the countdown from `McpFileRegistry.acquire()` and `execJson()` only —
  never from `ensureReady()`/`probeFileState()`, which the readiness poll also runs, or an idle
  session would keep itself alive. A tab the user is currently looking at (`McpTabHandle.isFocused`)
  is re-armed instead of closed; the next tool call for an evicted file just reopens it
- No tool call can hang past a client's patience. Inside the tab, each `exportAsync` (and each
  stored-image read) races a `withDeadline` timer — `EXPORT_NODE_TIMEOUT_MS`, capped by what is left
  of `EXPORT_BUDGET.timeMs` — so one stuck node becomes an `export_stalled` row and the others still
  come back; the budget alone could never do this, being checked only *between* nodes and therefore
  never at all for a one-node `get_screenshot`. That policy lives once, in `EXPORT_DEADLINE_JS`
  (`scripts/index.ts`), which both cyclic scripts paste in and which rejects with a `stalled`
  sentinel the catch they already have recognises by identity.
  Host-side, `McpFileRegistry.withFile()` races the
  tool's work against `TAB_WORK_TIMEOUT_MS`, under the 60 s at which clients drop a call, so the
  agent gets our message instead of a bare `The operation timed out.` That deadline sits **inside**
  `whileBusy`: `executeJavaScript` cannot be cancelled and does not reject when its tab goes away,
  so without it a stuck call left the file marked busy for the rest of the session. It starts after
  `ensureReady()`, so a slow file load is not charged against it
- Three log lines carry the numbers, and there is deliberately nothing else: `runTool` writes one
  on entry (a hanging call used to leave no trace at all) and one
  per call (tool, fileKey, node count/format for exports, ms, `ok` or the error code) and
  `McpFileSession` one the first time the Plugin API answers, counted from the tab opening.
  `FILE_OPEN_TIMEOUT_MS` is 45 s for the same reason — MCP clients drop a call at 60 s, and an
  agent that hits the transport timeout gets an empty message instead of our tab state and the
  hint to retry, so the constant must stay below the client's
- Started in `App.ready()`; `App` adapts `WindowManager` to the `McpTabHost` port

**UrlHandlerIntegration** (`src/main/UrlHandlerIntegration.ts`):
- Makes sure `figma://` reaches the app when no package registered it: an AppImage always writes/refreshes its own `.desktop` (path may move); a bare binary (`nix run`, unpacked zip) writes a "local" entry only if `xdg-mime` reports no handler at all. Flatpak and dev are skipped. Rules live in the pure `planUrlHandler()` (unit-tested)

### Renderer Process Structure

**Preload Bridge** (`src/main/preload/bridge.ts`):
- Exposes `window.figmaApi` via `contextBridge` — the only IPC surface for Panel and Settings
- Three typed methods: `send(channel, ...args)`, `invoke(channel, ...args)`, `on(channel, listener)`
- `SEND_CHANNELS`, `RECEIVE_CHANNELS`, `INVOKE_CHANNELS` act as an allowlist — see the file for the current list
- **Adding a new IPC channel requires updating all three of: the allowlist in bridge.ts, the ipcRegistry in the relevant controller, and the renderer call site**

**Panel** (`src/renderer/Panel/App.svelte`):
- Top toolbar with frame-specific Left/Tabs/Right components
- IPC listeners registered in `src/renderer/Panel/ipc.svelte.ts`
- Svelte stores in `src/renderer/Panel/store/`: `currentTab`, `tabs`, `panelZoom`

**Settings** (`src/renderer/Settings/`):
- Modal dialog for app settings
- Settings saved via `window.figmaApi.send("closeSettingsView", settings)`

**DesktopAPI** (`src/renderer/DesktopAPI/`):
- `webBinding.ts` — Establishes two-way MessageChannel with Figma web app; exposes `window.__figmaDesktop`
- This is NOT the preload IPC bridge — messages come through the MessageChannel, not `window.figmaApi`

### IPC Communication

All IPC goes through `window.figmaApi` (renderer) ↔ `ipcRegistry` (main). The authoritative channel lists live in `src/main/preload/bridge.ts` (`SEND_CHANNELS`, `RECEIVE_CHANNELS`, `INVOKE_CHANNELS`).

### Path Aliases (tsconfig.json)

The project uses TypeScript path aliases for cleaner imports:

```typescript
import { logger } from "Main/Logger";
import { CheckBox } from "Common/Input";
import { BASE_DEFAULT_SETTINGS } from "Utils/Common/defaultSettings";
```

Aliases:
- `Main/*` → `src/main/*`
- `Utils/*` → `src/utils/*`
- `Common/*` → `src/renderer/Common/*`
- `Components/*` → `src/renderer/components/*`
- `Store/*` → `src/renderer/stores/*`
- `Types/*` → `src/types/*`
- `Const` → `src/constants`

When adding new code, use these aliases instead of relative paths.

### Settings Structure

Persisted at `~/.config/figma-linux-next/settings.json`. Authoritative source:
`src/utils/Common/defaultSettings.ts` (`BASE_DEFAULT_SETTINGS`) and `src/types/` interfaces.

Three files carry the name `defaultSettings.ts`, and only the first holds values:

| File | Holds |
|---|---|
| `Utils/Common/defaultSettings.ts` | `BASE_DEFAULT_SETTINGS` — every environment-independent default |
| `Utils/Main/defaultSettings.ts` | Main-process layer: `clientId`, `$HOME`-derived paths |
| `Utils/Render/defaultSettings.ts` | `export { BASE_DEFAULT_SETTINGS as DEFAULT_SETTINGS }` — 4 lines, a shape placeholder; the renderer's real values arrive over the `getSettings` IPC |

## Extension System

Extensions are plugins loaded from `~/.config/figma-linux-next/Extensions/`.

**Structure**:
- `manifest.json` - Extension metadata
- UI/Code/Resource files (`.ts`, `.js`, `.css`, `.html`)

**Development**:
- Drop extension folder into Extensions directory
- ExtensionManager watches files with Chokidar
- Hot-reloading on code changes
- No app restart needed

Extensions registered in `settings.json` under `savedExtensions`.

## Platform-Specific Features

### GPU Acceleration & Wayland

The App class applies extensive Chromium flags in `applySwitches()`:
- GPU acceleration flags (critical for Figma's WebGL canvas)
- Wayland support detection and enablement
- Hardware video decoding (VAAPI)
- Color space management (sRGB option)

Custom switches can be added in settings under `app.commandSwitches`.

### Window Frame Styles

`Types.FrameStyle` is `"windows" | "gnome" | "macos" | "kde"` (`src/types/Common/index.d.ts`).

- `app.frameStyleAuto` (default `true`) picks the frame from the desktop environment:
  `detectFrameStyle()` in `src/utils/Main/desktopEnvironment.ts` reads `XDG_CURRENT_DESKTOP` /
  `DESKTOP_SESSION` — KDE/Plasma → `kde`, GNOME/Budgie → `gnome`, anything else → `windows` (Legacy). Only main can see the env,
  so renderers get the resolved value from the `getRuntimeInfo` invoke, never from `app.frameStyle`.
- `app.frameStyle` is the manual override, used only when `frameStyleAuto` is off.
- `gnome` (Adwaita), `kde` (Breeze glyphs, `Icons/Breeze*.svelte`, LGPL) and `windows` are
  implemented; `macos` is a placeholder on top of the Windows style.
- Frames are theme-aware: every colour goes through the `--frame-*` palette in
  `src/renderer/theme.css`, scoped by `#panel[data-frame]` × `html[data-theme]`. Figma's theme
  choice (`dark`/`light`/`system`) arrives via `setFigmaTheme`, is resolved in `src/main/Theme.ts`
  (`system` → `nativeTheme.shouldUseDarkColors`) and pushed to panels as `figmaThemeChanged`.
  Never hardcode a colour in `src/renderer/Panel/frames/`.

## Logging

**Logger** (`src/main/Logger/AppLogger.ts`):
- Multi-sink architecture: console + file
- File logs: `~/.config/figma-linux-next/logs/figma-linux-next.log`
- Configurable log level in settings

## Critical Files Reference

| File | Purpose |
|------|---------|
| `vite.config.mts` | Vite build config (main + renderer) |
| `src/main/index.ts` | App entry point; initializes storage, dialogs, dependencies |
| `src/main/App.ts` | Lifecycle orchestration, Chromium switches, controller wiring |
| `src/main/controllers/registry.ts` | IPC channel registry (seal-on-startup pattern) |
| `src/main/controllers/` | IPC controllers: Settings, Auth, Font, Clipboard, File |
| `src/main/preload/bridge.ts` | contextBridge → `window.figmaApi`; IPC channel allowlists |
| `src/main/Storage.ts` | Settings persistence |
| `src/main/Ui/WindowManager.ts` | Window lifecycle & routing |
| `src/main/Ui/Window.ts` | Single window: BrowserWindow + TabManager + warm tab |
| `src/main/Ui/TabManager.ts` | Tab management per window |
| `src/main/Dialogs/index.ts` | Dialog provider (Native / Zenity) |
| `src/main/MCP/McpService.ts` | MCP server facade (port 3845): HTTP transport + fileKey-addressed file registry + temp asset store |
| `src/main/MCP/scripts/exportNodes.ts` | The in-tab export script (`buildExportNodesScript()`) and its wire types, shared by `get_screenshot` / `download_assets` |
| `src/main/MCP/scripts/exportDesign.ts` | The in-tab `JSON_REST_V1` export behind `get_design` (page load, depth pruning, raw size cap) |
| `src/main/MCP/scripts/exportImageFills.ts` | The in-tab fill reader behind `download_image_fills` (hash matching, original bytes, pixel size) |
| `src/main/MCP/assets/imageTypes.ts` | Stored-image containers: extension↔mime table plus magic-byte sniffing |
| `src/main/MCP/design/` | `get_design` pipeline: `simplify.ts` (figma-developer-mcp + `tidyDesign`, cut-node detection, `designFlags`), `svgColors.ts` (the collapsed-icon colours and the traversal hook), `rootLayout.ts` (the parentless node gets its real `dimensions`), `linearGradient.ts` (linear gradients recomputed from the node size), `serializeTree.ts` (Framelink `tree` renderer) |
| `src/main/UrlHandlerIntegration.ts` | figma:// handler registration for AppImage / bare-binary launches |
| `src/main/ExtensionManager.ts` | Plugin system with hot-reloading |
| `src/renderer/Panel/App.svelte` | Main toolbar UI |
| `src/renderer/Panel/ipc.svelte.ts` | Panel IPC listener registrations |
| `src/renderer/DesktopAPI/webBinding.ts` | Figma web ↔ desktop MessageChannel bridge |
| `src/utils/Common/defaultSettings.ts` | `BASE_DEFAULT_SETTINGS` — authoritative settings schema |
| `src/utils/Main/defaultSettings.ts` | Env-dependent defaults layered on the base (clientId, `$HOME` paths) |
| `src/utils/Render/defaultSettings.ts` | Re-export of the base for the renderer — no values of its own |
| `src/utils/Render/frameTheme.ts` | Frame style icon/component config (`FrameConfig`) |
| `src/renderer/Panel/frames/` | Per-frame Svelte components (`FramedPanel`, `FramedLeft`, `FramedTabs`, `FramedRight`) |
| `config/builder.json` | electron-builder package config |
| `src/package.json` | Production manifest copied to `dist/` during build — **must stay in sync with `package.json` dependencies** |

## Important Gotchas

### Electron version is exact (no caret) — every bump needs a manual OAuth test
`package.json` lists an exact version, currently `"electron": "44.2.0"` (Chromium 152, Node 24), bumped 2026-09-07. OAuth login re-verification on 44.2.0: **pending**.

History: 43.3.0 shipped a StatusNotifierItem regression (tray icons invisible on GNOME/AppIndicator, Cinnamon, XFCE; electron#52674, fixed in 43.4.1). 44.0 rebuilt the `clipboard` module: every method is async, payloads are `ClipboardItem` → `Blob` by MIME type, `readImage/writeImage/readBuffer/writeBuffer` are gone, and the module no longer exists in renderers — which is why `ClipboardController` now owns both read and write and the tab preload only forwards `getClipboardData`/`setClipboardData`.

The pin exists because of a past regression: Electron 42.3.0 (Chromium 148.0.7778.180) shipped a Chromium roll (PR #51600, 1293 commits) carrying a `request_header_integrity` change in Google's closed-source signed-integrity-headers component. Figma's server validated those headers and silently rejected `/app_auth/redeem` — the response was login HTML instead of `Set-Cookie`, so first-login and add-account both broke with no error message. The project sat on 42.0.1 until 43.3.0 was confirmed clean.

**Before any bump**, build and run a first login against clean storage and verify `Set-Cookie` lands. Two things make this test easy to get wrong:

- **Test the bundled binary from `node_modules`.** Distro Electron packages (Arch's `electronNN`) are rebuilt from source and may not carry the same closed-source components, so a green run there says nothing about what electron-builder ships.
- **Isolate config via `XDG_CONFIG_HOME`, and copy `~/.config/mimeapps.list` into it.** The default-browser mapping lives in that file; without it gio picks an arbitrary browser and the login opens in the wrong one.

The `figma://` redirect must reach the instance under test. Registering a second `.desktop` does not work — Firefox keeps its own handler list and offers the installed entry. Shadow `/usr/share/applications/figma-linux-next.desktop` with a copy in `~/.local/share/applications` that keeps `Name`/`MimeType` and redirects `Exec`.

Note `app.getApplicationInfoForProtocol()` gained Linux support during the 42.x line (absent in 41.x and 42.0.1, present in 42.8.0+). Guard it with `typeof` before calling — the AUR `figma-linux-next` package runs against whatever system Electron is installed.

### Two package.json files — keep dependencies in sync
`package.json` is the dev manifest. `src/package.json` is a separate production manifest that gets copied to `dist/` during `bun run build`, then `bun install --production` runs inside `dist/`. **When updating a runtime dependency version in `package.json`, update `src/package.json` too**, otherwise the installed package in production builds will be the old version.

### TabManager.getById() fallback
`TabManager.getById(id)` falls back to returning `mainTab` when the ID is not found (instead of `undefined`). This is a known footgun — calling `closeTab()` or `removeChildView()` on the result of an unknown ID will silently operate on `mainTab`. Always guard with `tabManager.getAll().has(id)` before calling `getById` for dynamic IDs.

### Figma web app → desktop IPC (webBinding.ts)
Figma sends fire-and-forget messages to `window.__figmaDesktop` via the message channel. Unhandled messages log `[desktop] Unhandled message <name>` warnings. To silence a message without implementing it, add a no-op stub in the `publicAPI` object in `src/renderer/DesktopAPI/webBinding.ts`. DEV-mode `console.debug` is acceptable for stubs to aid future implementation.

### Warm tab and double-close
When the user clicks Home Tab, the renderer sends both `setFocusToMainTab` IPC **and** `closeTab(newFileTabId)`. The main process `setFocusToMainTab()` also calls `closeNewFileTab()` internally. This double-close is intentional — the guard in `closeTab()` (`tabManager.getAll().has(id)`) prevents the second call from accidentally removing `mainTab`.

### Child views are attached once — switch with setVisible, never detach and re-attach
Tab views, the tab preview card and the Settings / What's New overlays are added to
`window.contentView` once, hidden, the moment they are created (`Window.attachHidden()`; the
overlays in the `ModalViewManager` constructor) and afterwards only toggled with
`view.setVisible()`. On Wayland with Electron 44 a `WebContentsView` that is `removeChildView`ed and
later `addChildView`ed again never becomes visible: `document.visibilityState` stays `hidden`,
nothing paints and the tab shows white until a relayout (verified 2026-09-07 on GNOME 50 with a
minimal repro; Electron 43 was fine, and X11/xvfb — where the e2e suite runs — never reproduces it).
Re-adding an *attached* view is safe and is how overlays raise themselves above tabs attached since
(`addChildView` on a current child reorders it to the top). `removeChildView` is reserved for views
about to be destroyed (`closeTab`, `closeAllTab`, community close, warm-tab discard).

Tab thumbnails: `captureThumbnail()` is fired *before* the outgoing tab is hidden — a hidden view
has no compositor surface and `capturePage()` rejects with `UnknownVizError`. Do not try to capture
a background tab on demand; `tab.thumbnail` is the only source the hover card has.

### openFile must close the New File tab
`Window.openFile()` must call `closeNewFileTab()` after opening the file tab. Without this, the New File tab stays visible as a leftover. `createFile()` already does this — keep them consistent.

### The Plugin API needs frames — mcp tabs are parked, and painted on demand
Chromium reports a `WebContentsView` hidden both when it is detached from the window and when a
sibling view covers it completely (verified live: detached, or mounted under the focused tab, the
file loads but every tool times out with `visibility: hidden`). `Window.mountMcpTab()` therefore
keeps an unfocused mcp tab attached at 1×1 px under the panel strip (which does not list it), at
`x = tab.id` so parked tabs never cover each other. Every other tab view is attached once and
switched with `setVisible` (see the Wayland note in `Window.swapTo`); an mcp tab is the exception
that stays shown, so `swapTo()` re-parks it instead of hiding it. Modal views (settings, changelog)
do cover it while open;
`McpFileSession.ensureReady()` re-probes on every call and recovers.

Staying uncovered is necessary but **not sufficient**, and `document.visibilityState` is not the
condition — frames are. With the app window minimized the parked tab reported itself `visible` and
still never brought up `window.figma`, because the compositor had stopped painting: measured on a
1920×5642 landing, `Plugin API ready in 410.7s`, and six consecutive 45 s waits that all failed;
every png export queued behind it hung for minutes and the whole set flushed within 43 ms of the
user restoring the window. svg and `JSON_REST_V1` exports were unaffected throughout (9 ms while a
png of the same node had been hanging for 70 s), which is what makes the failure look like a
half-alive tab rather than a dead one — they are serialization, png is rasterization.
`McpFileSession.whileBusy()` supplies the frames: for exactly the span a tool call holds the tab it
runs a pump calling `McpTabHandle.paint()` (`webContents.capturePage()`, which raises Chromium's
capturer count and forces a frame) every `PAINT_PUMP_MS`. Both the Plugin-API wait and the export
sit inside that span, and nothing pumps between calls. Same file, window minimized, after the pump:
ready in 5.3 s, five png nodes at scale 1.5 in 1.5 s. `backgroundThrottling: false` on the mcp tab
was tried first — it does flip the tab to `visible`, but on its own it did not boot Figma, and with
the pump it changed nothing, so it is deliberately not set.

### app.whenReady() not app.on('ready', ...)
Always use `app.whenReady().then(...)` for the Electron ready handler. `app.on('ready', ...)` silently misses the event if registration is delayed (e.g. async startup). `app.whenReady()` resolves immediately if the app is already ready.

### IpcRegistry seal pattern
`ipcRegistry.seal()` is called in the `App` constructor after all controllers register. Any attempt to register an IPC handler after sealing throws immediately. This catches duplicate registrations and modules that try to add handlers too late. Never call `ipcMain` directly for new handlers — always go through `ipcRegistry`.

### contextBridge channel allowlist
`window.figmaApi` enforces channel allowlists at runtime. Any `send()`/`invoke()`/`on()` call with an unlisted channel silently no-ops or rejects. When adding a new IPC flow, update the allowlists in `src/main/preload/bridge.ts` (`SEND_CHANNELS`, `RECEIVE_CHANNELS`, or `INVOKE_CHANNELS`).

### EPIPE guard in uncaughtException
`src/main/index.ts` ignores `EPIPE` errors in the `uncaughtException` handler. Logging an EPIPE through the same broken pipe triggers another EPIPE → infinite loop. This guard is intentional — do not remove it.

### Branching strategy
- `staging` — integration branch, all features/fixes and version bumps happen here
- `dev` — stable release branch, **protected**: no direct pushes, no force pushes, CI must pass; merges only via PR from `staging`
- `.jules/` — local-only folder (gitignored) with task instructions for the Jules AI agent

**Release flow** (tag push triggers CI/release — push tag ONLY after staging merges into dev):
1. Commit all changes to `staging`, update `CHANGELOG.md`
2. `perl scripts/bump_version.pl X.Y.Z` — rewrites `package.json`, `src/package.json` and the Flatpak metadata (via `sync_flatpak_release.py --version`), then creates the version bump commit + tag **locally** on `staging`. It aborts before committing if the Flatpak step fails.
3. `git push origin staging` — push branch only, **do NOT push the tag yet**
4. Open PR: `staging → dev` on GitHub, wait for CI green, merge
5. `git push origin vX.Y.Z` — push tag **after merge** → triggers `release.yml` → GitHub Release + AUR update

⚠️ Never push the tag before the PR is merged — that would release before dev is updated, defeating branch protection.

**`enforce_admins: false`** — owner can bypass protection in emergencies.

### CI/CD automation (`release.yml`)

Tag push (`v*.*.*`) triggers `release.yml` which runs these jobs **in sequence**:

1. **`build-x64`** — builds deb, rpm, AppImage, zip on Ubuntu (electron-builder bundles Electron)
2. **`build-arm64`** — same formats on native ARM runner
3. **`build-pacman`** — builds `.pacman` in Arch container (electron-builder bundles Electron)
4. **`build-flatpak`** — builds a `.flatpak` bundle from `flatpak/app.borys.FigmaLinuxNext.yml` in the `bilelmoussaoui/flatpak-github-actions:freedesktop-24.08` container. x64 only (the manifest hardcodes the x64 Electron zip), and `continue-on-error: true` — a Flatpak failure costs the release its `.flatpak` and nothing else. Note this builds the manifest's `tag:`, so `sync_flatpak_release.py` keeping that tag current is what makes the bundle match the release.
5. **`release`** — collects all artifacts, computes SHA256SUMS, creates GitHub Release via `softprops/action-gh-release`. The Flatpak download step is `continue-on-error` since the artifact may not exist.
6. **`aur`** — clones `ssh://aur@aur.archlinux.org/figma-linux-next.git`, updates `pkgver` + SHA256 in PKGBUILD, generates `.SRCINFO`, pushes to AUR
7. **`aur-bin`** — same for `figma-linux-next-bin` (hashes the release zip instead of the tarball)
8. **`flake`** — recomputes the release zip hashes as SRI, runs `scripts/update_flake_release.py`, commits the pinned `flake.nix` to `dev` first, then mirrors it to `staging`
9. **`flatpak-repo`** — runs after `release`: pulls the previous repository state back from the live
   Pages site (`ostree pull --mirror --depth=1`), imports this release's `.flatpak` with
   `flatpak build-import-bundle`, signs and prunes (`--prune-depth=1`), writes the `.flatpakrepo` /
   `.flatpakref` files and `flatpak/pages/index.html`, then deploys the whole site with
   `actions/deploy-pages`. Pages is in **workflow** build mode (switched 2026-09-06), so the old
   Jekyll rendering of README at the same URL is gone — the site is now the Flatpak repo. Skipped
   when `build-flatpak` produced no bundle. Signing key: `FLATPAK_GPG_KEY` secret (armored private
   key, fingerprint `0519BE241207E6F2F0E18F0788A28A2C84E355F9`); public half committed as
   `flatpak/figma-linux-next-repo.gpg`. Losing the private key means every existing install must
   re-add the remote — keep a copy outside GitHub. The `github-pages` environment has a
   deployment-branch policy; the job runs from a *tag*, so the policy must include a `v*` rule of
   type `tag` next to `dev` (added 2026-09-07 after v0.20.0 failed with "Tag is not allowed to
   deploy to github-pages"). Check with
   `gh api repos/arximus88/figma-linux-next/environments/github-pages/deployment-branch-policies`.
10. **`flatpak-pin`** — runs `scripts/sync_flatpak_release.py --commit <tag sha>` and commits the pinned manifest to `dev`, then `staging`. Depends on `flake` as well as `release`: both push to `dev`, and run in parallel the loser is rejected as non-fast-forward. Distinct from `build-flatpak`, which produces the bundle.

Secrets required: `ID_RSA` (AUR SSH key, base64-encoded), `USER_NAME`, `EMAIL`, `RELEASE_PAT`, `FLATPAK_GPG_KEY` (armored GPG private key that signs the Pages Flatpak repo).

**`flake.nix` pins version + hashes together** and is updated by CI, not by `bump_version.pl` — the hashes don't exist until the release binaries are built. Never bump the version in `flake.nix` by hand: it would name a release whose hashes it doesn't have, and every `nix build` would fail on a hash mismatch.

### Flatpak release metadata — `scripts/sync_flatpak_release.py`

The app version appears in four files, and the Flatpak one fails quietly: a stale `tag:` in
`flatpak/app.borys.FigmaLinuxNext.yml` builds, installs and runs — it just packages the
*previous* release. Nothing else in the pipeline notices. The script is the single writer:

| Mode | Called by | Does |
|---|---|---|
| `--version X.Y.Z` | `bump_version.pl` | rewrites `tag:`, `flatpak/package.json` version, adds a `<release>` to the metainfo, drops the previous `commit:` pin |
| `--commit SHA` | `release.yml` `flatpak` job | pins the git source to the tag's commit |
| `--check` | `ci.yml` on every push/PR | fails on any drift |

The split exists because the commit sha does not exist until the tag is pushed, the same
reason `flake.nix` is CI-owned.

`--check` covers more than the version: the Electron pin across `package.json`,
`flatpak/package.json`, the `unzip` path and `generated-sources.json`; dependency equality
between root and `flatpak/package.json`; and the vendored sources themselves — every npm
tarball's hash against `flatpak/package-lock.json`, plus a host allowlist
(npm/github.com/electronjs.org) so a hand-added source is rejected.

**Electron bumps are checked, never rewritten** — a new Electron needs
`flatpak-node-generator` re-run with network access (commands are in the manifest header),
so the script reports the drift instead of producing a lockfile it cannot vendor.

**`RELEASE_PAT`** is a fine-grained PAT (`Contents: Read and write`, this repo only, created 2026-08-05, **expires 2027-08-05**). It exists because Nix resolves `github:arximus88/figma-linux-next` from `dev`, and the default `GITHUB_TOKEN` cannot push to a protected branch — without it NixOS users would always install the previous release. When it expires the `flake` job starts failing with a 403 on push and nothing else changes; regenerate it and `gh secret set RELEASE_PAT`. The job runs last and depends on `release`, so a rejected push never blocks the release itself.

Other workflows:
- `ci.yml` — runs on push **and** PR to both `staging` and `dev` (type check, lint, unit tests, Flatpak metadata check)
- `remove_artefacts.yml` — cleanup

### AUR packages

| Package | Electron | Auto-updated | Repo |
|---------|----------|-------------|------|
| `figma-linux-next` | System (whatever `pacman -S electron` gives) | Yes — `release.yml` `aur` job | `ssh://aur@aur.archlinux.org/figma-linux-next.git` |
| `figma-linux-next-bin` | Bundled (from GitHub Release zip) | Yes — `release.yml` `aur-bin` job | `ssh://aur@aur.archlinux.org/figma-linux-next-bin.git` |

Local AUR repos: `/home/arx/aur/figma-linux-next/`, `/home/arx/aur/figma-linux-next-bin/`

**Pacman uses system Electron** — version may lag behind project's Electron. `-bin` package bundles Electron from the release zip for version parity.

### bun test and electron mocking
bun validates named ESM exports statically before mocks run. `src/utils/Main/net.ts` imports `{ net }` from electron, so any test that touches the `Utils/Main` import chain needs electron pre-mocked. The preload at `tests/unit/electron-preload.ts` (registered via `bunfig.toml`) handles this globally — do not add per-file electron mocks.

## Common Development Tasks

When modifying the codebase:

1. **Adding a new setting**:
   - Add the value to `src/utils/Common/defaultSettings.ts` (`BASE_DEFAULT_SETTINGS`) —
     the `Render/` and `Main/` files of the same name will not do what you want
   - Add to TypeScript interface in `src/types/`
   - Update Settings UI if user-configurable

2. **Adding IPC handlers**:
   - Create or update a controller in `src/main/controllers/`
   - Register via `ipcRegistry.on()` or `ipcRegistry.handle()` (never `ipcMain` directly)
   - Add the channel to the appropriate allowlist in `src/main/preload/bridge.ts`
   - Call from renderer via `window.figmaApi.send()`, `.invoke()`, or `.on()`

3. **Working with tabs**:
   - TabManager handles lifecycle; each tab is a `WebContentsView`
   - Always check `tabManager.getAll().has(id)` before `getById()` on dynamic IDs
   - URL changes propagate to main process for state saving

4. **Working with extensions**:
   - ExtensionManager scans Extensions directory
   - manifest.json required
   - File watching enables hot-reloading

## Testing Package Builds

```bash
# Build and install locally
bun run pack
bun run local:install

# Run from /opt/figma-linux-next
/opt/figma-linux-next/figma-linux-next
```

## Environment Variables

For local development, create `.env`:

```env
NODE_ENV=dev
DEV_PANEL_PORT=3330
DEV_SETTINGS_PORT=3331
```
