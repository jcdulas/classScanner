# classScanner — Specification

A VS Code extension that scans a folder of C++ sources and displays an interactive class diagram in WebGL, designed to stay smooth and readable beyond 1000 classes.

Status: specification v1, implemented. Sections 8 and 11 give the measured results.

## 1. Scope

### In scope

- Scanning a folder, with configurable depth, for `.cpp`, `.hpp` and `.h` files.
- Extracting classes, structs, unions, enums and templates, with their members.
- Seven relation types, each one toggled on or off separately.
- A WebGL diagram (PixiJS v8) with semantic zoom, three layouts and collapsible groups.
- Classes can be dragged with the mouse; the arrangement is saved in the workspace.
- Navigation: go to source, search, filters, neighborhood focus, minimap, PNG/SVG export.
- Exports of the selected classes: a compact text schema for language models, and their source files in a `.zip` archive.

### Out of scope for v1

- Semantic analysis through clang / clangd (no `compile_commands.json`).
- Incremental scanning: every scan, manual or after a file is saved, is complete.
- Nodes for `typedef` / `using` and free functions.
- Editing code from the diagram.
- Languages other than C++.

### Compatibility

- The extension must work on VS Code 1.130.0 and later: `engines.vscode` is `^1.130.0` in `package.json`.
- `@types/vscode` is pinned to the newest published version that is not newer than 1.130.0 (`1.125.0`: no `1.130.x` version of the package exists), so that using a recent API fails at compile time.
- Extension tests run against VS Code 1.130.0 in addition to the current stable version.
- The extension host code and the webview code only use the Node and browser features available in the runtimes bundled with VS Code 1.130.0.

### Code and documentation requirements

- Everything is written in English: code, comments, documentation, UI text, commit messages.
- The code must be understandable by an intermediate developer with about five years of experience. The concrete rules are in [CLAUDE.md](../CLAUDE.md).

## 2. Scanning and analysis

### 2.1 Triggers

| Command | Access | Effect |
|---|---|---|
| `classScanner.scanFolder` | Right-click on a folder in the explorer, command palette | Asks for the depth, scans, opens the diagram |
| `classScanner.rescan` | Button in the diagram toolbar, command palette | Runs a complete scan again with the same parameters |
| `classScanner.changeDepth` | Depth button in the status of the diagram, command palette | Asks for another depth and scans again |
| `classScanner.exportDiagram` | Toolbar, command palette | PNG or SVG export |

The scan is always complete: no cache is kept between two scans. When a diagram is reopened, the folder is scanned again and the saved arrangement is reapplied (§6).

While a diagram is open, saving a C++ file of its folder, or of its paired folder (§2.2), scans the folder again one second later (several saves in a row give one scan). The arrangement, the selection and the camera are kept; the progress is shown in the status bar only. The setting `classScanner.rescanOnSave` turns this off.

### 2.2 Depth and file selection

- Depth `0`: only the files directly in the folder. Depth `N`: up to N levels of subfolders. `-1`: unlimited (default).
- The depth is asked the first time a folder is scanned, prefilled with the last value used. A folder that has a saved arrangement is scanned again with its saved depth, which "Change Scan Depth" changes.
- Exclusions are configurable globs. Default: `**/build/**`, `**/out/**`, `**/node_modules/**`, `**/.git/**`, `**/third_party/**`, `**/external/**`.
- Files above a size limit (default 2 MB) are skipped and listed in the scan report. The size is checked when the file is opened to be read.

Paired header and source folders. Many projects keep their headers and their sources in two sibling folders with the same tree inside, `inc/core/engine.h` and `src/core/engine.cpp`. Scanning `src/core` alone would find method definitions without their classes, so the two halves are scanned together:

- When a folder of the scanned path, or the scanned folder itself, is named `src`, `source` or `sources`, the same path under a sibling named `inc`, `include` or `includes` is scanned too, if it exists; and the other way round. Names are compared without case. Scanning `project/src/core` also scans `project/inc/core`; scanning `project/inc` also scans `project/src`.
- The closest such folder that has a counterpart on disk is used. Without one, the folder is scanned alone.
- The depth and the exclusions apply to both folders.
- File paths are then relative to the folder that contains the two trees (`project`), so they start with `src/` or `inc/`. The saved arrangement stays attached to the folder the user scanned.
- The scan report and the status of the diagram name the paired folder.

### 2.3 Parser

- `web-tree-sitter` (WASM) with the `tree-sitter-cpp` grammar, bundled in the extension: no native dependency, no build configuration.
- Parsing is spread over a pool of `worker_threads` in the extension host, with progress and cancellation through `vscode.window.withProgress`.
- `.h` files are parsed with the C++ grammar, even when they contain C.
- The scan is written for slow file systems such as network drives, where each file system call waits for a round trip to the server:
  - listing the files costs one call per folder and none per file, and several folders are listed at the same time;
  - each parser worker reads its files with synchronous calls. Asynchronous calls of Node share one pool of 4 threads for the whole process; with synchronous calls every worker waits for its own file.

### 2.4 Known tree-sitter limits and workarounds

| Problem | Workaround |
|---|---|
| Export macros (`class MYLIB_API Foo : public Bar`) that break the parsing of the declaration | A pre-pass replaces with spaces (offsets preserved) the macros listed in `classScanner.ignoredMacros`, plus automatic detection of an `ALL_CAPS` identifier between `class`/`struct` and the name |
| `#if` / `#else` branches | All branches are parsed, duplicate declarations are merged |
| No type resolution | Heuristic resolution by name (§2.6) |
| Complex templates, macros that generate classes | Best effort; unrecognized declarations are counted in the scan report |

### 2.5 Extracted entities

| Entity | Extracted content |
|---|---|
| `class`, `struct`, `union` | Qualified name, namespace, file and line, attributes (name, type, visibility, `static`), methods (name, signature, visibility, `virtual`, `static`, `const`, pure virtual), base classes |
| `enum`, `enum class` | Qualified name, underlying type, values |
| Template | Parameters shown in the name (`Foo<T>`); specializations are attached to the primary template and listed in its card |

Merge rules:

- The identity of an entity is its qualified name (`ns::Outer::Inner`).
- A declaration in a header and the method definitions in a `.cpp` (`Foo::bar() {…}`) feed the same node.
- A forward declaration (`class Foo;`) is ignored when a definition exists. Otherwise it produces an "external" node, hidden by default.
- An abstract class (at least one pure virtual method) is flagged as such.

### 2.6 Type name resolution

For each referenced type, in order:

1. Exact qualified name, resolved from the current namespace outward to the enclosing namespaces, taking the file's `using namespace` directives into account.
2. `typedef` / `using` aliases, resolved one level deep.
3. Short name that is unique in the whole project.
4. Otherwise: unresolved. The relation is dropped and counted in the scan report.

Types outside the project (`std::string`, `int`…) produce neither a node nor an edge.

## 3. Relations

Each type has its own toggle in the side panel. Only inheritance is active when the diagram opens.

| Type | Detection | Notation |
|---|---|---|
| Inheritance | Base class list, with visibility and `virtual` | Solid line, hollow triangle |
| Composition | Member by value, `std::unique_ptr<T>`, container of values (`std::vector<T>`) | Solid line, filled diamond |
| Aggregation | Pointer member, reference, `shared_ptr` / `weak_ptr`, container of pointers | Solid line, hollow diamond |
| Dependency | Types of method parameters and return values; types used in method bodies (local variables, `new T`, `T::f()`, casts) | Dashed line, open arrow |
| Include | `#include` between project files, drawn once between the main class of each file | Thin dotted line |
| Friend | `friend class` declarations | Dashed line, «friend» label |
| Nesting | Class declared inside another one | Solid line, circled plus on the container side |

Rules:

- Template arguments are explored: `std::map<Key, std::shared_ptr<Value>>` produces one relation to `Key` and one to `Value`.
- A dependency from A to B is not created when an inheritance, composition or aggregation from A to B already exists.
- Edges of the same type between the same two classes are deduplicated; for composition and aggregation, a `*` multiplicity wins over `1`.
- Edges from a class to itself are dropped.
- Dependencies found in `.cpp` bodies are attached to the class that owns the method. Code in free functions is ignored.
- An include is a relation between two files. Drawing it between every class of one file and every class of the other would add many edges that say nothing more, so it is drawn once, between the main class of each file: the class named like the file (`scene.h` and `Scene`), otherwise the first class that is not nested in another. For a `.cpp` file, the classes considered are those whose methods it defines.
- Without the include paths of the compiler, an include is matched to a scanned file relative to the folder of the including file, then by path suffix (`<mylib/core/engine.h>` finds `include/mylib/core/engine.h`). When several files match, the one whose folders resemble most those of the including file wins: `#include "util.h"` in `src/core/engine.cpp` is `inc/core/util.h`, not `inc/net/util.h`.

## 4. Diagram

### 4.1 Rendering

- PixiJS v8 (WebGL2) in a VS Code webview.
- Text uses PixiJS bitmap fonts made from the editor font. (MSDF fonts were considered; they need a font file prepared at build time, which rules out using the user's editor font.)
- Readable text is as sharp as text drawn by the editor, because its characters fall exactly on the pixels of the screen:
  - when the zoom stops, a font is drawn for the exact size, in device pixels, of each text size in use, and the texts are created again with it;
  - cards, texts and the diagram itself are placed on whole device pixels;
  - while the zoom is changing, texts keep the font of the previous zoom, scaled, and are sharp again 150 ms after it stops;
  - group titles, which keep one size on screen, are always sharp.
- Fonts drawn once at 32 px and scaled are used where an exact font is not worth it or not possible: below a zoom of 0.5, where text is under 6 pixels tall, for the big class names of the compact level, whose size differs for every card, for the «friend» labels of relations, and for texts with characters outside of printable ASCII.
- PNG exports draw the text for the pixels of the image in the same way.
- Viewport culling backed by a spatial index (Flatbush); text objects exist only for the cards on screen at a level of detail that displays text, and are destroyed when the card leaves the screen.
- Edges are drawn in batches, one batch per relation type. Turning a type off hides its batch; turning it on shows the batch, redrawing it only if the view changed in the meantime.
- Edges are built for an area larger than the view and rebuilt when the camera stops after leaving that area or zooming by more than 30%.
- Dashed and dotted lines are drawn dash by dash. A batch that would need more than 20,000 dashes is drawn with solid lines instead.

### 4.2 Style

The whole interface follows a "liquid glass" style, with a VS Code touch: every color comes from the active theme (light, dark, high contrast), the accent is the theme's focus color, and the fonts are those of VS Code and of its editor.

- **Controls**: translucent panels that blur what is behind them (`backdrop-filter`), with a bright rim at the top, soft shadows and pill shapes. No native HTML control is used: selects, check boxes, sliders and buttons are replaced by segmented controls, dropdown menus, switches, custom check boxes and steppers (`src/webview/ui/controls.tsx`), all usable with the keyboard. Icons are inline SVG.
- **Cards**: rounded corners, a header with a top-to-bottom gradient in the color of the group (namespace or folder), a slightly see-through body, a bright rim inside the border and a soft shadow. Real blur behind 1500 cards would be too costly in WebGL, so the glass look is suggested with these cheap shapes (`src/webview/render/glassStyle.ts`).
- **Groups**: panes of glass tinted with the group color.
- **Background**: the canvas is transparent; the page behind it shows the editor background with soft patches of the accent colors.
- Each member has an icon: a diamond for a method, a circle for an attribute, in the color of its visibility (green for public, yellow for protected, red for private, taken from the theme's chart colors).
- Italics for abstract classes and virtual methods; a badge for `struct`, `union`, `enum` and templates.
- Colors are updated when the theme changes.

### 4.3 Compact view and full view

Three levels of detail, driven by the zoom:

| Level | Zoom (screen pixels per diagram unit) | Card in `auto` mode | Pinned `compact` | Pinned `full` |
|---|---|---|---|---|
| Overview | below 0.2 | Colored rectangle; group names only | Colored rectangle | Colored rectangle |
| Compact | 0.2 to 0.55 | Class name, enlarged to fill the card | Class name, enlarged | All members |
| Full | 0.55 and above | Header, attributes, methods (capped) | Header only | All members |

This semantic zoom is controlled by the "Simplify cards" switch of the side panel, on by default. When it is off, cards keep the content of the Full level at every zoom level. Their text is only drawn when it is at least about 2 screen pixels tall (zoom of 0.15 and above): below that it cannot be seen, and drawing it for 1500 cards costs 20 frames per second instead of 60.

Each class has a display mode: `auto` (default, follows the zoom), `compact` or `full` (pinned). At the Overview level every card is a plain rectangle whatever its mode: text would not be readable there. Pinning is done with a double-click, the context menu, or on the whole selection. Two global buttons force everything to compact or to full; a third one returns to `auto`. As almost every card then changes size, these three buttons compute the layout again.

Card footprint in the layout:

- The footprint of a card in `auto` mode is the one of its full view, capped at 12 member lines (beyond that: a "+ N more" line). Zooming therefore changes the content of the card without ever moving its neighbors.
- A card pinned to `full` shows all its members: it grows and pushes its neighbors away locally.
- A card pinned to `compact` shrinks to its header; the freed space is only reclaimed on demand ("Recompute layout").

### 4.4 Layouts

Three layouts to choose from in the toolbar, computed in a web worker:

| Layout | Description | Engine |
|---|---|---|
| Grouped (default) | Collapsible groups; inside each group, layers that follow the structural relations; groups are then packed next to each other, related groups close together | elkjs (layered, then rectpacking) |
| Global hierarchy | A single layered layout, base classes at the top | elkjs (layered) |
| Organic | Force simulation, strongly linked classes move closer; classes of a group start close together | d3-force |

- Grouping criterion to choose from: namespace (default), folder, file, none.
- Group boxes and collapsing exist in the grouped layout only. In the other layouts the classes of a group are scattered, so the group only shows as the header color of its cards.
- Groups are packed in an order where groups with many relations between them (of any type) follow each other, so that they end up side by side.
- A collapsed group becomes a single node showing its name and its number of classes. Collapsing or expanding a group packs the groups again: a collapsed group gives its room back. The cards keep their place inside their group.
- The layout only uses the relation types checked as "structural" (default: inheritance and composition), so that enabling dependencies does not disrupt the arrangement.
- The global hierarchy, and groups of more than 300 classes in the grouped layout, are layered by inheritance only. With composition as well, a dense project gives chains hundreds of layers deep (measured: 20 s of computation and a diagram 3 million units tall, against 0.7 s with inheritance only).
- Switching layout animates the transition. Each layout keeps its own manual positions.
- "Recompute layout" computes the current layout again: it reclaims the room freed by compact cards and discards the manual positions of that layout.
- The layout only places the classes kept by the "Show" filters (entity types, forward-declared classes). Changing one of these filters computes the current layout again, so that hidden classes leave no hole and shown ones get a real place; the other layouts are computed again when they are shown. This discards the manual positions, and can be undone. The namespace and folder filters hide cards in place instead: the other cards do not move.

### 4.5 Edge readability at scale

- By default, the relations that are turned on stay visible at every zoom level: edges are not hidden or merged because the view is far away.
- The "Merge relations" switch of the side panel, off by default, merges them when zoomed out instead: at the Overview level of the grouped layout, the edges between two groups become a single link, and the edges inside a group are not drawn.
- Edges are drawn thin, so that they take little room: lines of about 1 screen pixel, whatever the zoom, and arrow heads and diamonds of 7 screen pixels. Far away, arrow heads and diamonds shrink with the cards instead of covering them.
- In the grouped and global hierarchy layouts, edges are orthogonal: horizontal and vertical segments with rounded corners. An edge leaves a card through the side that faces the other card and enters the other card through the facing side. The edges that share a side of a card are spread along it and ordered like the cards they lead to. The derived classes of a base class all arrive at the middle of its side, where they share one arrow head and form a tree. In the organic layout, where cards are placed in every direction, edges are straight segments.
- Edges are routed one relation type at a time, each type slightly shifted, so that toggling a type does not move the others. They do not avoid the cards in their way: they pass behind them.
- When many edges of a type are on screen, they are drawn more transparent: up to 400 edges are almost opaque, and thousands form a veil that leaves the cards visible.
- When a group is collapsed, the edges that reach it always merge into a single link per pair of groups. The thickness of a merged link grows with the logarithm of the number of relations; hovering shows the count per type.
- Edges whose two ends are outside the viewport are not drawn.
- Selecting a class brings its edges to the front and dims the others.

### 4.6 Interactions

| Action | Effect |
|---|---|
| Mouse wheel, drag on the background | Zoom centered on the cursor, pan |
| Ctrl+drag (Cmd on macOS), anywhere | Rectangle selection of several classes; with Shift, added to the selection |
| Shift+drag on the background | Rectangle selection added to the selection |
| Drag a card or a group title | Moves it. Dragging a selected card moves the whole selection |
| Click on a class | Selects it alone, with neighborhood focus: its relations are highlighted, the rest is dimmed. Nothing else: a click never opens a file |
| Ctrl+click on a class (Cmd on macOS), or Shift+click | Adds the class to the selection, or removes it |
| Click on a group title | Selects the classes of the group |
| "Isolate" (context menu) | Shows only the class and its neighbors up to N levels (N adjustable from 1 to 5) |
| Alt+click on a class | Opens what is under the pointer in the editor: the declaration of the member on a member line, the declaration of the class elsewhere |
| Click on an arrow | Opens the declaration of its relation in the editor (see below). The arrow under the pointer is drawn in the accent color, with a hand cursor |
| Double-click on a card | Cycles the mode `auto` → `full` → `compact` |
| Double-click on a group title | Collapses or expands the group |
| Right-click | Context menu: display modes, isolate, open the header or the source file of the class, go to the member under the pointer, exports of the selection, collapse the group |
| Ctrl+F | Search by name (substring, case-insensitive) among classes, methods and attributes. Enter recenters on the class of the result, Ctrl+Enter opens the result in the editor |
| Ctrl+Z, Ctrl+Y | Undo and redo the changes of the arrangement: moves (one step per drag), display modes, collapsed groups, layout, grouping, "Recompute layout", the layout computed for a "Show" filter (the filter itself stays as it is). Up to 50 steps, kept until the next scan |
| Escape | Closes the menu, then clears the selection, then leaves the isolation |

A tooltip shows the qualified name of a card when its text is not readable, the counts of a merged link, and the relation of the arrow under the pointer with the file and line that a click opens (`Composition: Engine → Timer · click to open engine.h:12`).

Each mouse gesture does one thing. On a card, a click selects, a double-click changes the display mode, a drag moves: none of them opens a file, so a file is never opened by accident, or twice by a double-click. An arrow has nothing to select or to move, so a click on it opens its declaration; the highlight of the arrow under the pointer shows beforehand that a click does something there.

Opening the declaration of a relation:

- The declaration is the line of the sources that creates the relation:

  | Relation | Line that is opened |
  |---|---|
  | Inheritance | The base class in the list of bases of the derived class |
  | Composition, aggregation | The attribute |
  | Dependency | The method, for a type of its parameters or of its return value; the first line that uses the class, for a type used in the code of a method |
  | Include | The `#include` directive |
  | Friend | The `friend` declaration |
  | Nesting | The declaration of the nested class |

- When several declarations create the same relation, the first one found is opened: declarations in class bodies come before code in `.cpp` files.
- An arrow is under the pointer when the pointer is within 5 screen pixels of its line. Cards hide the arrows that pass behind them. While classes are selected, their arrows, drawn over the others, are looked at first, and the click keeps the selection.
- A merged link (§4.5) stands for several relations: a click on it opens nothing.

Opening a class in the editor:

- A class has up to two files to open: the file that declares it, usually a header, and the file that implements it, usually a `.cpp`. The selection bar and the context menu show one entry per file, named after it (`engine.h`, `engine.cpp`), so that the user chooses.
- The implementation is the first method of the class defined outside of it, in another file than the declaration. When methods are defined in several files, the file named like the one of the declaration wins. When no method is found, it is the top of the companion source file of the header (§4.7), if there is one. A class that lives in a single file has one entry.

Where files open, whatever opened them (a class, a member, an arrow, a search result):

- Every file opens in the same editor column: the column on the right of the diagram; when there is none, the column on its left; when the diagram is alone, a new column on its right. A third column is never created while a column that can show code exists.
- In that column a file is shown in one editor only: the tab it already has, or a preview tab that the next file replaces.

The diagram fills the whole view; the user interface floats above it:

- **Top left**: side panel toggle, search, undo and redo.
- **Top center**: layout (segmented control), grouping criterion (dropdown), "Recompute layout", and the display mode of every card (auto, compact, full).
- **Top right**: rescan and export.
- **Side panel** (left, can be hidden; each section can be folded):
  - a switch for each of the seven relation types, with its line style and edge count;
  - "Zoomed out": the switches "Simplify cards" (§4.3) and "Merge relations" (§4.5);
  - the isolation depth;
  - "Show": filters by entity type (class, struct, union, enum, template) and display of external nodes (declarations without a definition); changing one computes the layout again (§4.4);
  - filters by namespace and by folder (check box trees with a text filter), which hide cards in place.
- **Bottom left**: status (classes shown, level of detail, scan duration), the scan depth, which is a button to change it, and access to the scan report.
- **Bottom right**: zoom controls (zoom out, zoom level, zoom in, fit) above the minimap, which shows the groups and a draggable viewport rectangle.
- **Selection bar** (bottom center, only while classes are selected): display mode of the selection; for a single class, isolate and one button per file to open (header, source file); schema for a language model, sources as `.zip`, clear the selection.

"Fit" places the diagram in the part of the view that the floating panels leave free. Below 1280 px of width the controls of the top bars keep only their icon, and below 860 px so do the buttons.

### 4.7 Export

- PNG: current view or whole diagram, with a scale factor. The whole diagram is rendered in tiles when it exceeds the maximum texture size.
- SVG: generated from the model (not from a WebGL capture), selectable text, whole diagram or selection.
- The export respects the current filters, active relations and display modes.

Exports of the selected classes, from the "Export Diagram" command or the context menu:

- **Schema for a language model**: compact text, close to C++ declarations, that can be pasted into a prompt. Classes are grouped by namespace, each with its bases, members, and file and line; the active relations follow, one line each (`A *-- B`, `A o-- B`, `A ..> B`...), split between relations inside the selection and relations leaving it. A legend at the top explains the notation. It is copied to the clipboard or saved as a Markdown file. The same schema can be exported for every visible class.
  - The size of a prompt matters, so the schema can be made lighter: all members, without private members, public members only, or no member at all (classes and relations only); and with or without the file and line of each class. When members are left out, the header of the schema says so.
  - The "LLM schema" button of the selection bar opens a panel with these two options and an estimate of the size in tokens (about one token for four characters), updated as the options change. The options are saved with the arrangement. The "Export Diagram" command asks for them.
- **Sources as a `.zip` archive**, either keeping the folder tree of the scanned folder or flat (every file at the root; files with the same name get their folders in their name, `core/util.h` → `core_util.h`). The files of a class are:
  - the file that declares it;
  - the files that define its methods outside the class, found by the scan;
  - its companion files: files with the same name and another extension. Headers and sources are often kept in separate trees, so when several files have the right name, the one whose folders resemble most those of the file wins, counting the folders they have in common from the file upward: `inc/core/engine.h` goes with `src/core/engine.cpp` (mirror trees), and `include/myproject/engine.h` with `src/engine.cpp` (an extra folder level). Two files are companions only when each is the best match of the other; without any folder in common, a file is only taken when it is the only candidate.

## 5. Architecture

```
Extension host (Node)                      Webview
┌──────────────────────────────┐           ┌────────────────────────────────┐
│ Commands, configuration      │           │ UI: toolbar, side panel,       │
│ Scanner: file discovery      │   graph   │     search (DOM, Preact)       │
│ worker_threads pool          │ ────────► │ Rendering: PixiJS v8           │
│   └ tree-sitter-cpp (WASM)   │           │ Layout worker: elkjs, d3-force │
│ Model: symbols, relations    │ ◄──────── │ Spatial index, LOD, culling    │
│ Layout persistence           │  actions  │ PNG / SVG export               │
└──────────────────────────────┘           └────────────────────────────────┘
```

Messages between the two sides:

| Direction | Message | Content |
|---|---|---|
| host → webview | `graph` | Complete graph, scan report, saved arrangement |
| host → webview | `scanProgress` | Scan progress |
| webview → host | `openSource` | File, line |
| webview → host | `saveState` | Arrangement, sent after 1 s without changes |
| webview → host | `rescan`, `startExport` | Rescan request; opens the export choices |
| host → webview | `exportRequest` | Format (`png`, `svg`, `schema`), scope, scale |
| webview → host | `exportResult` | Base64 PNG, SVG text or schema text |
| webview → host | `exportSources`, `copyToClipboard` | Classes whose sources to archive; text to copy |

The complete list is in `src/shared/messages.ts`.

Data model sent to the webview:

```ts
interface Graph {
  root: string;                 // folder the file paths are relative to: the scanned folder,
                                // or the parent of the scanned folder and its paired folder (§2.2)
  nodes: ClassNode[];
  edges: Edge[];
  files: string[];              // relative paths, referenced by index
}

interface ClassNode {
  id: string;                   // qualified name
  name: string;
  kind: 'class' | 'struct' | 'union' | 'enum';
  namespace: string;
  file: number; line: number;   // declaration
  definitionFiles?: number[];   // other files that define its methods (.cpp)
  implementation?: { file: number; line: number };  // where "open the source file" goes (§4.6)
  templateParams?: string[];
  specializations?: string[];
  isAbstract: boolean;
  isExternal: boolean;          // declared but not defined in the scan
  attributes: Member[];
  methods: Member[];
  enumValues?: string[];
}

interface Member {
  name: string;
  signature: string;            // type, or parameters and return type
  visibility: 'public' | 'protected' | 'private';
  flags: number;                // static, virtual, pure, const
  file: number; line: number;
}

interface Edge {
  from: string; to: string;
  kind: 'inherit' | 'compose' | 'aggregate' | 'depend' | 'include' | 'friend' | 'nest';
  file: number; line: number;                    // where the relation is declared (§4.6)
  access?: 'public' | 'protected' | 'private';   // inheritance
  multiplicity?: '1' | '*';                      // composition, aggregation
}
```

## 6. Persistence

- File `.classscanner/<folder-name>-<short hash of the path>.json` at the workspace root, readable and suitable for version control.
- Content: scan parameters (folder, depth), active layout and grouping criterion, positions per layout (indexed by qualified name), pinned display modes, collapsed groups, active relations, filters, the two zoom switches, camera.
- After a rescan: known classes get their position back; new ones are placed near their group; entries of classes that disappeared are removed.
- "Recompute layout" (§4.4) discards the manual positions of the current layout.
- Outside of a workspace, the file is stored in the extension's global storage instead.

## 7. Configuration

| Setting | Default | Purpose |
|---|---|---|
| `classScanner.maxDepth` | `-1` | Depth suggested on the first scan |
| `classScanner.extensions` | `[".cpp", ".hpp", ".h"]` | Analyzed extensions |
| `classScanner.exclude` | see §2.2 | Excluded globs |
| `classScanner.maxFileSizeKB` | `2048` | Maximum size of an analyzed file |
| `classScanner.ignoredMacros` | `[]` | Macros to neutralize before parsing |
| `classScanner.maxMembersInAutoMode` | `12` | Line cap of a card in `auto` mode |
| `classScanner.structuralRelations` | `["inherit", "compose"]` | Relations taken into account by the layout |
| `classScanner.rescanOnSave` | `true` | Scan again when a C++ file of an open diagram is saved |

## 8. Performance targets

Reference machine: recent development laptop, integrated GPU. Reference project: 1500 classes, 2000 files, 10,000 edges.

The measurements were made on the synthetic project of the test suite (`npm run generate:synthetic`: 1500 classes, 2000 files, about 24,000 edges, which is denser than the reference project), with `npm run benchmark` and `npm run test:integration` in VS Code 1.130.0.

| Operation | Target | Measured |
|---|---|---|
| Complete scan | under 15 s | 0.9 to 1.7 s |
| Computing a layout | under 5 s, without blocking the interface | grouped 1.4 s, global hierarchy 0.4 s, organic 1.6 s |
| Complete scan on a slow disk | no target | simulated with `npm run benchmark -- --latency 10` (10 ms per file system call, 2000 files, 8 workers): 8.5 s, of which 0.2 s to list the files. It was 37 s, of which 21 s to list the files, when the size of each file was asked while listing and files were read with asynchronous calls |
| Display after layout | under 1 s | not measured on its own: 1.6 to 1.9 s from the start of the scan to the diagram on screen, scan and layout included |
| Pan and zoom | 60 frames/s | 57 to 60 frames/s at the three levels of detail, every relation type active; 60 frames/s with "Simplify cards" off |
| Toggling a relation type | under 100 ms | with the whole diagram in view and orthogonal edges: about 20 ms to turn off, about 35 ms to turn on with a batch to redraw |
| Search | result in under 50 ms | not measured (a linear scan of 1500 names) |
| Webview memory | under 500 MB | not measured |

## 9. Tests

- **Unit tests** (`npm test`, vitest): a corpus of C++ files covering each construct (multiple inheritance, templates, nested classes, export macros, `#if`...) in `test/fixtures/constructs`, a small multi-file project in `test/fixtures/project`, a project with paired `inc` and `src` trees in `test/fixtures/paired`, and tests of name resolution, relations, card geometry, layouts, the webview store, the schema and the source file collection.
- **Integration tests** (`npm run test:integration`): run the extension in VS Code 1.130.0 (or another version with `--vscode-version`), scan the fixture project, check that the webview reports the diagram on screen without error, check the saved arrangement, and export PNG, SVG, schema and `.zip` files to `out/integration/`. They also scan one half of a pair of folders, and check that files opened from the diagram go to a single editor column, on the right of the diagram or on its left, and that opening a file twice shows a single editor. On the synthetic project they also measure frame times and relation toggle times.
- **Benchmark** (`npm run benchmark`): scan and layout times on the synthetic project.
- **Preview** (`npm run preview`): renders the webview in a headless browser, outside of VS Code, and saves a screenshot. Scenarios play user actions first (Ctrl+drag selection, wheel zoom, right-click, click, double-click and Alt+click on a card, hovering and clicking an arrow, dragging a card, Ctrl+Z, typing in the search box), which shows that these interactions work; the script prints the files that the scenario asked the editor to open.
- Not automated: assertions on mouse interactions, and validation on a real, large open-source project.

## 10. Milestones

All six milestones are implemented.

1. **Scan and model**: file discovery, tree-sitter extraction, relation resolution, scan report, extractor tests.
2. **Minimal diagram**: webview, PixiJS rendering of cards and inheritance edges, grouped layout, pan and zoom.
3. **Semantic zoom and relations**: three levels of detail, pinning, seven relation toggles, edge merging per group.
4. **Navigation**: go to source, search, filters, neighborhood focus, isolation.
5. **Arrangement**: manual moves, persistence, hierarchy and organic layouts, collapsible groups.
6. **Finishing**: minimap, PNG and SVG export, themes, measuring and meeting the performance targets, `.vsix` packaging.

Added after the first version: rectangle selection with Ctrl+drag, schema for language models, sources as a `.zip` archive, paired header and source folders.

## 11. Points that were to be validated with a prototype

- **Card footprint** (§4.3): implemented as specified (capped full footprint in `auto` mode). It keeps the arrangement stable while zooming. Whether the diagram feels too spread out on a real project is still to be judged by eye; the alternative is a compact footprint with full cards drawn as overlays.
- **elkjs at 1500 nodes**: measured, see §8. The grouped layout uses the planned fallback from the start (one layout per group, then packing with ELK's `rectpacking`). The layered algorithm does not scale with dense composition, hence the inheritance-only rule of §4.4.
- **Export macros**: the automatic removal works on the fixture corpus. The rate of missed classes on a real project without any `ignoredMacros` configuration has not been measured.
