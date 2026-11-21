# Developing classScanner

What the extension does is described in [SPEC.md](SPEC.md). The coding rules and a map of the code are in [CLAUDE.md](../CLAUDE.md).

## Commands

```sh
npm install                # use --ignore-scripts to skip the optional native build of tree-sitter-cpp
npm run build              # bundles everything into dist/ with esbuild
npm run watch              # rebuilds on change
npm run typecheck          # TypeScript checks of the Node code, then of the webview code
npm test                   # unit tests (vitest)
npm run test:integration   # builds, then runs the extension in VS Code 1.130.0
npm run generate:synthetic # creates test/synthetic-project (1500 classes)
npm run benchmark          # scan and layout times on the synthetic project; add `-- --latency 10` to simulate a network drive
npm run preview            # screenshot of the webview in a headless browser, in out/preview/
npm run icon               # renders assets/icon.svg to assets/icon.png
npm run package            # increments the patch version, then production build and .vsix
```

Press F5 in VS Code to start an Extension Development Host with the extension loaded.

## Checking a change

- `npm run typecheck` and `npm test` after every change.
- `npm run test:integration` after a change to the extension host or the webview. It runs the real webview in VS Code 1.130.0, the oldest supported version, and writes PNG, SVG, schema and zip exports to `out/integration/`. When the synthetic project exists, it also measures frame rates and relation toggle times. To test the current VS Code instead, run `npm run build`, then `node scripts/runIntegrationTests.mjs --vscode-version stable`.
- `npm run preview` after a change to the user interface or the drawing. It is the only way to see the HTML controls without starting VS Code. Options: `--theme dark|light`, `--scenario default|selection|zoom|menu|menuAt|zoomAt|click|hover|doubleClick|drag|multiDrag|ctrlClickTwice|schemaPanel|interfacePanel|analysisPanel|reveal|search|toggleRow` (with `--x`, `--y`, `--undo 1`, `--text`, `--alt 1`, `--shift 1`, `--count 2`; `interfacePanel` takes `--text uses` to show its second list, or `--text precise` to press "Check calls with the C++ extension" (the harness answers); `analysisPanel` takes `--text cycles|path|usage|changes`; `reveal` takes the file in `--text` and the line in `--count`; the script prints the files a scenario asked the editor to open), `--relations all`, `--size 1000x700`, `--pixel-ratio 2` (a screen with that many device pixels per CSS pixel), `--folder test/synthetic-project`, `--output file.png`.

## Building a package

Every `.vsix` has its own version number. `npm run package` increments the patch version in `package.json`, builds the production bundles and writes `class-scanner-<version>.vsix`. Before running it, describe the changes of the new version at the top of [CHANGELOG.md](../CHANGELOG.md), then commit the version change with the work.

## Screenshots of the README

The images in `docs/images/` are made with the preview:

```sh
node scripts/previewWebview.mjs --relations all --output docs/images/diagram.png
node scripts/previewWebview.mjs --folder test/synthetic-project --relations inherit --output docs/images/overview.png
node scripts/previewWebview.mjs --scenario zoom --output docs/images/detail.png
node scripts/previewWebview.mjs --scenario selection --theme light --output docs/images/selection.png
```

On the extension page of VS Code, images are loaded from GitHub: `vsce` rewrites the relative links of the README to the default branch of the repository. A new or changed image only shows there once it is pushed to that branch.
