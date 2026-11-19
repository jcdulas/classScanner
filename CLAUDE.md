# classScanner

A VS Code extension that scans a folder of C++ sources (`.cpp`, `.hpp`, `.h`) and displays an interactive WebGL class diagram that stays usable beyond 1000 classes.

The full specification is in [docs/SPEC.md](docs/SPEC.md). Read it before implementing anything, and update it in the same change whenever a decision in it changes.

## Project status

Specification only: no code and no build tooling yet. When the extension is scaffolded, add the install, build, test and launch commands to this file.

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
- Optimize only where a performance target in the spec requires it, and say so in a comment next to the optimization.
- Do not add abstraction layers, configuration options or extension points that the spec does not ask for.

## Technology choices

These are decided in the spec; do not replace them without asking.

| Area | Choice |
|---|---|
| Minimum VS Code version | 1.130.0 (`engines.vscode: ^1.130.0`, `@types/vscode` pinned to `1.125.0`, the newest version not newer than 1.130.0) |
| Language | TypeScript |
| C++ parsing | `web-tree-sitter` with the `tree-sitter-cpp` grammar, in `worker_threads` |
| Rendering | PixiJS v8 (WebGL2) in a webview |
| Layout | elkjs and d3-force, in a web worker |
| Webview UI | Preact |

Do not use a VS Code API, Node feature or browser feature that is missing from VS Code 1.130.0, even if it works in the locally installed version.

## Architecture

Two sides that communicate only through typed messages (spec §5):

- **Extension host** (Node): commands, file discovery, parsing, building the graph model, saving the layout.
- **Webview**: rendering, layout computation, interactions, export.

The graph data model shared by both sides is defined in spec §5. Keep it in a single shared module.

## Testing

- Every C++ construct the extractor supports has a fixture file and a unit test that checks the extracted graph (spec §9).
- Performance targets (spec §8) are measured on the synthetic project generator, not estimated.
