# Packaging Cool CAM as a desktop app

Decision (2026-09-28): **Electron via electron-vite**, with the local API extracted into its own package so the browser dev
loop stays exactly as it is today.

## Why Electron, not Tauri

- Every backend piece is already Node: the jobs/fonts/tool-library API in the Vite plugin, the MCP server, the node-only
  helpers in core. Electron's main process runs them unchanged. Tauri's backend is Rust; that code would be rewritten or
  shipped as a Node sidecar, which bundles Node anyway and loses most of Tauri's size advantage.
- WebGL consistency. The viewer is three.js plus a simulation worker. Electron is Chromium everywhere; Tauri uses the system
  webview, and WebKitGTK on Linux is where WebGL apps get flaky.
- The Electron binary can run any Node script with `ELECTRON_RUN_AS_NODE=1`, so the packaged app also serves as the MCP
  server for Claude Code without a separate Node install.
- Precedent: gSender and CNCjs are Electron; the audience already runs apps like this.
- Cost: 150–200 MB installers and Chromium's memory footprint. Acceptable for a desktop CAM tool.

Tauri wins only if binary size or a Rust backend were goals. They are not.

## Layout

The renderer never learns whether it runs in a browser tab or an Electron window: it keeps calling `fetch('/api/...')`.
Only the host of that API changes.

```
packages/
  core, post, sim      unchanged
  server               NEW: the Vite plugin's handlers as a plain Node module
                       createApi({ jobsDir, libraryFile, fontDirs }) → (req, res) handler + change watcher
  mcp                  unchanged; also shipped inside the desktop bundle
  viewer               unchanged renderer; vite.config.ts mounts packages/server as middleware
  desktop              NEW: Electron main + preload (~150 lines), electron-vite config,
                       electron-builder config, icons
```

## Dev cycle

| Command | What it does |
|---|---|
| `npm run dev` | Vite + your browser. Unchanged, fastest loop. |
| `npm run dev:desktop` | electron-vite starts the same Vite renderer with HMR inside an Electron window; main runs `packages/server`. |
| `npm run build:desktop` | electron-vite build, then electron-builder: dmg/zip (macOS universal), NSIS (Windows), AppImage + deb (Linux). |
| `npm run install:desktop` | macOS: copies the built bundle to `~/Applications/Cool CAM.app`. Run the app from there, never from `packages/desktop/dist`: rebuilding into the folder of a running app crashes it. |

First launch of every new build: macOS asks "Cool CAM.app would like to access files in your Documents folder" (the jobs folder lives there). The app's main thread blocks until you answer, so the window shows nothing, or a bare `ERR_FAILED` loading the local URL, until you click Allow. The prompt repeats after each rebuild because an ad-hoc signature changes with every build and macOS keys the permission on it; Developer ID signing makes it a one-time question. Never run the app from a folder inside Documents either: Chromium's helper processes then hit the same prompt while loading the window.

Packaged-app diagnostics: the main process mirrors its console to `~/Library/Logs/Cool CAM/main.log` (server URL, jobs folder, library file, window load failures, renderer errors). The Help menu's "Copy MCP config" shows the jobs folder. `Cool CAM.app/Contents/MacOS/Cool CAM --screenshot out.png` runs headless-ish and quits after capturing the window.
| CI | tests + typecheck on every push; packaging on a version tag with a macOS/Windows/Linux matrix. |

## What packaging forces (all small)

- Default jobs folder moves to `~/Documents/Cool CAM/jobs` (`app.getPath('documents')`). The tool library already lives in
  the per-user data dir (`packages/core/src/node-paths.ts`).
- Font directories per platform: Windows `C:\Windows\Fonts`, Linux `/usr/share/fonts` and `~/.fonts`; today only macOS
  paths plus `library/fonts` are listed.
- Native menu and file dialogs later, through IPC; the in-app menubar works as is.
- Toolpath generation on a worker matters more once a native window can look frozen.
- Code signing is a separate decision: unsigned builds trigger Gatekeeper and SmartScreen warnings; notarization needs an
  Apple developer account, Windows needs a certificate. Ship unsigned to yourself first.
  - **macOS today:** the build is ad-hoc signed under our bundle id (`build/after-pack.cjs`). An app copied out of the dmg
    is quarantined and Gatekeeper will say the developer cannot be verified: right-click → Open (or System Settings →
    Privacy & Security → Open Anyway), or clear the flag with `xattr -cr "/Applications/Cool CAM.app"`. Launching the
    `.app` from `packages/desktop/dist/mac-universal` directly is not quarantined and just runs. Without the after-pack
    signing step the same copy reports "damaged and can't be opened".
  - Set `CSC_NAME` (a "Developer ID Application" certificate) plus notarization to remove the prompt entirely.

## Status

- [x] 1. `packages/server` extracted; Vite mounts it as middleware; `/api/events` (SSE) replaces the Vite websocket for live reload.
- [x] 2. `packages/desktop` (electron-vite 5, Electron 44, ESM main). `npm run dev:desktop` = HMR in an Electron window;
      `npx electron packages/desktop` runs the production path (internal server + built renderer) without packaging.
      `--screenshot out.png` captures the window and quits (smoke tests). Toolpath generation runs on a worker.
- [x] 3. First packaged build: `Cool CAM-0.1.0-mac.dmg` / `.zip` (universal, unsigned, ~225 MB). Icons rendered from the
      viewer's SVG by `packages/desktop/build/make-icons.mjs` (run with `npx electron`). The main process bundles the
      workspace packages (no node_modules in the asar); the MCP server ships as one esbuild bundle in `Resources/mcp`.
      First launch seeds `~/Documents/Cool CAM/jobs` with the example jobs and opens one. Windows/Linux builds not yet
      exercised (need a CI matrix or those machines).
- [ ] 4. MCP settings: the File menu already copies a `.mcp.json` entry (Electron as Node + bundled MCP server); a proper
      settings screen with the jobs-folder chooser is still to do.
- [ ] 5. CI matrix on tags, signing, auto-update.

## Order of work

1. Extract `packages/server` from the Vite plugin; keep the plugin as a thin wrapper. No behaviour change; verifiable with
   the existing dev loop.
2. Add `packages/desktop` with electron-vite: main starts the server on a free localhost port and opens the window at that
   URL. First runnable app.
3. electron-builder config, icons, per-platform font paths, Documents-folder default.
4. MCP settings screen: writes the `.mcp.json` snippet using the bundled server and the Electron binary as Node.
5. GitHub Actions matrix build on tags; auto-update through electron-updater once builds are signed.

A cheap extra that falls out of step 1: `npx cool-cam`, which runs the server and opens the default browser, for Linux or
headless boxes, with no Electron at all.
