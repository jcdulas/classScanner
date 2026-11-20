# classScanner

A VS Code extension that scans a folder of C++ sources (`.cpp`, `.hpp`, `.h`) and displays an interactive WebGL class diagram that stays usable beyond 1000 classes.

The full specification is in [docs/SPEC.md](docs/SPEC.md). Read it before changing behavior, and update it in the same change whenever a decision in it changes. [README.md](README.md) is the page users see for the extension in VS Code: keep it about using the extension, and put developer documentation in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Record user-visible changes in [CHANGELOG.md](CHANGELOG.md).

## Commands

```sh
npm install                # use --ignore-scripts to skip the optional native build of tree-sitter-cpp
npm run build              # bundles everything into dist/ with esbuild
npm run watch              # rebuilds on change
npm run typecheck          # tsc on the Node code, then on the webview code
npm test                   # unit tests (vitest), about 1 s
npm run test:integration   # builds, then runs the extension in VS Code 1.130.0
npm run generate:synthetic # creates test/synthetic-project (1500 classes)
npm run benchmark          # scan and layout times on the synthetic project
npm run preview            # screenshot of the webview in headless Chrome, written to out/preview/
npm run icon               # renders assets/icon.svg to assets/icon.png (the extension icon)
npm run package            # increments the patch version, then production build and .vsix
```

Run `npm run typecheck` and `npm test` after every change. Run `npm run test:integration` after any change to the extension host or the webview: it is the only test that runs the real webview. It writes PNG, SVG, schema and zip files to `out/integration/`; look at the PNG files to check the rendering. When the synthetic project exists, it also measures frame rates and relation toggle times (spec §8).

After any change to the user interface or to the drawing, run `npm run preview` and look at the screenshot: it is the only way to see the HTML controls, which the PNG exports of the integration tests do not contain. Options: `--theme dark|light`, `--scenario default|selection|zoom|menu|menuAt|zoomAt|click|doubleClick|drag|multiDrag|ctrlClickTwice|schemaPanel|search|toggleRow` (scripted user actions, see `test/preview/harness.html`), `--x 0.5 --y 0.5`, `--undo 1`, `--text area`, `--alt 1` and `--count 2` (for `click`), `--state '{...}'`, `--relations all`, `--size 1000x700`, `--folder test/synthetic-project`, `--output file.png`.

Press F5 in VS Code to try the extension by hand.

## Versions and packages

Every `.vsix` gets its own version number: never build two different packages with the same version.

- `npm run package` increments the patch version in `package.json` (0.1.1 becomes 0.1.2) before building. Do not call `vsce package` directly.
- Before running it, add a section for the new version at the top of [CHANGELOG.md](CHANGELOG.md) with the user-visible changes since the previous package.
- Commit the version change (`package.json`, `package-lock.json`, `CHANGELOG.md`) with the work it packages.
- For a larger step, set the version by hand first (`npm version minor --no-git-tag-version`), then build with `npx vsce package --no-dependencies`.

## Language

Everything in this repository is written in English: code, identifiers, comments, documentation, UI text, log messages, commit messages. This holds even when the conversation with the user is in another language.

## Code readability

The code must be understandable by an intermediate developer with about five years of experience, who knows TypeScript but is not a specialist in WebGL, parsers or graph layout.

- Write plain, explicit TypeScript. Avoid advanced type-level programming (conditional types, complex mapped types, deep generics), decorators and metaprogramming.
- Prefer a few more lines of obvious code over a clever one-liner.
- Keep functions short and focused on one job. Keep one concept per file.
- Use full, descriptive names. No abbreviations other than well-known ones (`id`, `url`, `LOD` once defined).
- Start each module with a short comment that says what it is responsible for and how it fits in the architecture.
- Comment the "why", not the "what". Always explain the parts that need specialist knowledge: tree-sitter node handling, PixiJS batching and culling, level-of-detail thresholds, layout algorithms.
- Keep specialist code (parsing, rendering, layout) isolated behind small, plainly typed interfaces, so the rest of the code can be read without understanding it.
- Prefer a well-known library over a hand-written algorithm.
- Optimize only where a performance target in the spec requires it, and say so in a comment next to the optimization, with the measurement that justified it.
- Do not add abstraction layers, configuration options or extension points that the spec does not ask for.

## User interface style

The interface follows a "liquid glass" style with the colors and fonts of the VS Code theme (spec §4.2).

- Never use a native HTML control (`select`, `button`, `input type="checkbox"`, `input type="range"`...). Use the controls of `src/webview/ui/controls.tsx` (`GlassButton`, `Segmented`, `Dropdown`, `ToggleRow`, `Stepper`, `Section`) and add new ones there. The only native element is the text `input` of search fields, styled inside a `.search-field`.
- Floating panels use the `.glass` class; rows of controls add `.bar`. Colors come from the CSS variables at the top of `styles.css`, which derive from `--vscode-*` variables: never hard-code a theme color.
- Icons are inline SVG paths in `src/webview/ui/Icon.tsx`.
- Cards and groups drawn with PixiJS get their glass look from `src/webview/render/glassStyle.ts`.
- Check both themes and a narrow size (`--size 760x600`) with `npm run preview`.

## Technology choices

These are decided in the spec; do not replace them without asking.

| Area | Choice |
|---|---|
| Minimum VS Code version | 1.130.0 (`engines.vscode: ^1.130.0`, `@types/vscode` pinned to `1.125.0`, the newest version not newer than 1.130.0) |
| Language | TypeScript, bundled with esbuild |
| C++ parsing | `web-tree-sitter` with the `tree-sitter-cpp` grammar, in `worker_threads` |
| Rendering | PixiJS v8 (WebGL2) in a webview, bitmap fonts, Flatbush spatial index |
| Layout | elkjs and d3-force, in a web worker |
| Webview UI | Preact |
| Zip archives | fflate |

Do not use a VS Code API, Node feature or browser feature that is missing from VS Code 1.130.0, even if it works in the locally installed version.

## Architecture

Two sides that communicate only through the typed messages of `src/shared/messages.ts` (spec §5):

| Folder | Runs in | Role |
|---|---|---|
| `src/shared/` | both | Graph model, messages, saved arrangement. Plain data types only |
| `src/parser/` | worker threads | tree-sitter parsing of one file into `FileSymbols` (names not resolved yet) |
| `src/model/` | extension host | Merges all `FileSymbols`, resolves names, builds the graph and its relations |
| `src/scanner/` | extension host | File discovery, worker pool, scan orchestration. No VS Code API, so it runs in tests |
| `src/extension/` | extension host | Commands, webview panel, saved state, export flows |
| `src/webview/state/` | webview | `DiagramStore`: the single source of truth of the webview, with every action |
| `src/webview/model/` | webview | Pure geometry: cards, groups, edges, visibility. No DOM, so it runs in tests |
| `src/webview/layout/` | web worker | The three layouts |
| `src/webview/render/` | webview | PixiJS drawing, camera, culling, pointer interactions |
| `src/webview/export/` | webview | SVG and language-model schema, built from the model |
| `src/webview/ui/` | webview | Preact components |

How a change flows in the webview: an action of `DiagramStore` changes the state and emits the topics that changed; `DiagramRenderer` collects them and redraws once per frame; the Preact components re-render through `useStore`.

Things that are easy to break:

- The webview has a strict Content Security Policy. PixiJS needs the `pixi.js/unsafe-eval` import, and the layout worker is started from a `blob:` URL.
- File paths of a graph are relative to `Graph.root`, which is not always the scanned folder: with a paired folder (spec §2.2) it is their common parent. Resolve files against `graph.root`, never against the folder of the panel.
- Parser worker types live in `parserWorkerProtocol.ts` so that the extension never imports `parserWorker.ts`, whose top-level code starts a worker.
- `src/webview/` must not import from `src/extension/`, `src/model/` or `src/scanner/` (Node APIs), only from `src/shared/`.

## Testing

- Every C++ construct the extractor supports has a fixture file in `test/fixtures/constructs` and a unit test that checks what is extracted (spec §9).
- Logic that does not need the DOM (webview model, store, layouts, exports from the model) is unit-tested in Node.
- Performance targets (spec §8) are measured on the synthetic project, not estimated. Update the measured column of the spec when they change.
- Mouse interactions have no automated assertions. The preview scenarios play some of them (Ctrl+drag selection, wheel zoom, right-click, click and Alt+click) so that their result can be seen in a screenshot, and the preview script prints the files a scenario asked the editor to open; check the others by hand with F5.
- `test/fixtures/paired` has mirror `inc` and `src` trees, for the scan of paired folders (spec §2.2).
- To pass `--state` to the preview on Windows, call `node scripts/previewWebview.mjs` directly (after `npm run build`): `npm run` mangles the quotes of its JSON.
