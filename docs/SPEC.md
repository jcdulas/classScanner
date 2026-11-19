# classScanner — Specification

A VS Code extension that scans a folder of C++ sources and displays an interactive class diagram in WebGL, designed to stay smooth and readable beyond 1000 classes.

Status: specification v1, before implementation.

## 1. Scope

### In scope

- Scanning a folder, with configurable depth, for `.cpp`, `.hpp` and `.h` files.
- Extracting classes, structs, unions, enums and templates, with their members.
- Seven relation types, each one toggled on or off separately.
- A WebGL diagram (PixiJS v8) with semantic zoom, three layouts and collapsible groups.
- Classes can be dragged with the mouse; the arrangement is saved in the workspace.
- Navigation: go to source, search, filters, neighborhood focus, minimap, PNG/SVG export.

### Out of scope for v1

- Semantic analysis through clang / clangd (no `compile_commands.json`).
- Real-time updates and incremental caching: the scan is manual and complete.
- Nodes for `typedef` / `using` and free functions.
- Editing code from the diagram.
- Languages other than C++.

### Code and documentation requirements

- Everything is written in English: code, comments, documentation, UI text, commit messages.
- The code must be understandable by an intermediate developer with about five years of experience. The concrete rules are in [CLAUDE.md](../CLAUDE.md).

## 2. Scanning and analysis

### 2.1 Triggers

| Command | Access | Effect |
|---|---|---|
| `classScanner.scanFolder` | Right-click on a folder in the explorer, command palette | Asks for the depth, scans, opens the diagram |
| `classScanner.rescan` | Button in the diagram toolbar, command palette | Runs a complete scan again with the same parameters |
| `classScanner.exportDiagram` | Toolbar, command palette | PNG or SVG export |

The scan is always complete: no cache is kept between two scans. When a diagram is reopened, the folder is scanned again and the saved arrangement is reapplied (§6).

### 2.2 Depth and file selection

- Depth `0`: only the files directly in the folder. Depth `N`: up to N levels of subfolders. `-1`: unlimited (default).
- The depth is asked on every `scanFolder`, prefilled with the last value used.
- Exclusions are configurable globs. Default: `**/build/**`, `**/out/**`, `**/node_modules/**`, `**/.git/**`, `**/third_party/**`, `**/external/**`.
- Files above a size limit (default 2 MB) are skipped and listed in the scan report.

### 2.3 Parser

- `web-tree-sitter` (WASM) with the `tree-sitter-cpp` grammar, bundled in the extension: no native dependency, no build configuration.
- Parsing is spread over a pool of `worker_threads` in the extension host, with progress and cancellation through `vscode.window.withProgress`.
- `.h` files are parsed with the C++ grammar, even when they contain C.

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
| Include | `#include` between project files, projected onto the classes declared in those files | Thin dotted line |
| Friend | `friend class` declarations | Dashed line, «friend» label |
| Nesting | Class declared inside another one | Solid line, circled plus on the container side |

Rules:

- Template arguments are explored: `std::map<Key, std::shared_ptr<Value>>` produces one relation to `Key` and one to `Value`.
- A dependency from A to B is not created when an inheritance, composition or aggregation from A to B already exists.
- Edges of the same type between the same two classes are deduplicated; the multiplicity (`1`, `*`) is kept for composition and aggregation.
- Dependencies found in `.cpp` bodies are attached to the class that owns the method. Code in free functions is ignored.

## 4. Diagram

### 4.1 Rendering

- PixiJS v8 (WebGL2) in a VS Code webview.
- Text uses an MSDF bitmap font, sharp at every zoom level.
- Viewport culling backed by a spatial index; text objects are recycled (pool) and exist only for visible cards at a level of detail that displays them.
- Edges are drawn in batches, one batch per relation type: toggling a type shows or hides one batch.

### 4.2 Style

- Cards with rounded corners, header colored by group (namespace or folder).
- Visibility icons for public / protected / private; italics for abstract classes and virtual methods; a badge for `struct`, `union`, `enum` and templates.
- Colors derived from the active VS Code theme (light, dark, high contrast), updated when the theme changes.

### 4.3 Compact view and full view

Three levels of detail, driven by the zoom:

| Level | Zoom | Card content |
|---|---|---|
| Overview | far | Colored rectangle, no text; group names only |
| Compact | intermediate | Class name, enlarged to fill the card, and type badge |
| Full | close | Header, attributes, methods with signatures |

Each class has a display mode: `auto` (default, follows the zoom), `compact` or `full` (pinned, independent of the zoom). Pinning is done with a double-click, the context menu, or on the whole selection. Two global buttons force everything to compact or to full; a third one returns to `auto`.

Card footprint in the layout:

- The footprint of a card in `auto` mode is the one of its full view, capped at 12 member lines (beyond that: a "+ N more" line). Zooming therefore changes the content of the card without ever moving its neighbors.
- A card pinned to `full` shows all its members: it grows and pushes its neighbors away locally.
- A card pinned to `compact` shrinks to its header; the freed space is only reclaimed on demand ("Recompute layout").

### 4.4 Layouts

Three layouts to choose from in the toolbar, computed in a web worker:

| Layout | Description | Engine |
|---|---|---|
| Grouped (default) | Collapsible groups; inside each group, layers that follow inheritance; groups are then placed relative to each other | elkjs |
| Global hierarchy | A single layered layout, base classes at the top | elkjs (layered) |
| Organic | Force simulation, strongly linked classes move closer | d3-force |

- Grouping criterion to choose from: namespace (default), folder, file, none.
- A collapsed group becomes a single node showing its name and its number of classes.
- The layout only uses the relation types checked as "structural" (default: inheritance and composition), so that enabling dependencies does not disrupt the arrangement.
- Switching layout animates the transition. Each layout keeps its own manual positions.

### 4.5 Edge readability at scale

- When a group is collapsed, or at the Overview level, the edges between two groups merge into a single link whose thickness reflects the number of relations. Hovering shows the count per type.
- Individual edges appear from the Compact level on, for expanded groups.
- Edges whose two ends are outside the viewport are not drawn.
- Selecting a class brings its edges to the front and dims the others.

### 4.6 Interactions

| Action | Effect |
|---|---|
| Mouse wheel, drag on the background | Zoom centered on the cursor, pan |
| Drag a card or a group | Move; multiple selection with Shift+click or a rectangle |
| Click on a class | Selection and neighborhood focus: its relations are highlighted, the rest is dimmed |
| "Isolate" (context menu) | Shows only the class and its neighbors up to N levels (N adjustable from 1 to 5) |
| Ctrl+click on a class, click on a member | Opens the file at the declaration line in the editor |
| Double-click on a card | Cycles the mode `auto` → `full` → `compact` |
| Double-click on a group | Collapses or expands the group |
| Ctrl+F | Search by name (substring, case-insensitive), animated recentering on the result |

Collapsible side panel:

- Toggles for the seven relation types, each with its edge count.
- Filters by entity type (class, struct, union, enum, template), by namespace and by folder (checkbox trees).
- Display of external nodes (declarations without a definition).
- Choice of layout and grouping criterion.

Minimap in a corner: overview of the groups, draggable viewport rectangle.

### 4.7 Export

- PNG: current view or whole diagram, with a scale factor. The whole diagram is rendered in tiles when it exceeds the maximum texture size.
- SVG: generated from the model (not from a WebGL capture), selectable text, whole diagram or selection.
- The export respects the current filters, active relations and display modes.

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
| webview → host | `saveLayout` | Arrangement, sent after 1 s without changes |
| webview → host | `rescan`, `export` | Rescan request; data to write to disk |

Data model sent to the webview:

```ts
interface Graph {
  root: string;                 // scanned folder
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
  access?: 'public' | 'protected' | 'private';   // inheritance
  multiplicity?: '1' | '*';                      // composition, aggregation
}
```

## 6. Persistence

- File `.classscanner/<folder-name>-<short hash of the path>.json` at the workspace root, readable and suitable for version control.
- Content: scan parameters (folder, depth), active layout and grouping criterion, positions per layout (indexed by qualified name), pinned display modes, collapsed groups, active relations, filters, camera.
- After a rescan: known classes get their position back; new ones are placed near their group; entries of classes that disappeared are removed.
- "Reset layout" clears the manual positions of the current layout.

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

## 8. Performance targets

Reference machine: recent development laptop, integrated GPU. Reference project: 1500 classes, 2000 files, 10,000 edges.

| Operation | Target |
|---|---|
| Complete scan | under 15 s |
| Computing a layout | under 5 s, without blocking the interface |
| Display after layout | under 1 s |
| Pan and zoom | 60 frames/s |
| Toggling a relation type | under 100 ms |
| Search | result in under 50 ms |
| Webview memory | under 500 MB |

## 9. Tests

- A corpus of C++ test files covering each construct (multiple inheritance, templates, nested classes, export macros, `#if`) with the expected graph, checked by unit tests of the extractor.
- A synthetic project generator (N classes, adjustable relation density) to measure the targets of §8.
- Manual validation on a real, large open-source project.

## 10. Milestones

1. **Scan and model**: file discovery, tree-sitter extraction, relation resolution, scan report, extractor tests.
2. **Minimal diagram**: webview, PixiJS rendering of cards and inheritance edges, grouped layout, pan and zoom.
3. **Semantic zoom and relations**: three levels of detail, pinning, seven relation toggles, edge merging per group.
4. **Navigation**: go to source, search, filters, neighborhood focus, isolation.
5. **Arrangement**: manual moves, persistence, hierarchy and organic layouts, collapsible groups.
6. **Finishing**: minimap, PNG and SVG export, themes, measuring and meeting the performance targets, `.vsix` packaging.

## 11. Points to validate with a prototype

- **Card footprint** (§4.3): reserving the capped full footprint keeps the arrangement stable while zooming, but spreads the diagram out. To be confirmed visually on a large project as early as milestone 3; the alternative is a compact footprint with full cards drawn as overlays.
- **elkjs at 1500 nodes**: computation time of the grouped layout, to be measured at milestone 2. Fallback: one layout per group, then placing the groups with a custom packing algorithm.
- **Export macros**: rate of missed classes on a real project without any `ignoredMacros` configuration.
