# Changelog

## 0.1.2

- Undo and redo (Ctrl+Z, Ctrl+Y) for moves, display modes, collapsed groups and layout changes.
- Orthogonal edges with rounded corners, spread along the sides of the cards; derived classes share the arrow head of their base class.
- Related groups are placed side by side, and a collapsed group gives its room back.
- "Compact" and "Full" for every card compute the layout again instead of pushing cards one by one.
- An include is drawn once between the main classes of the two files, instead of between all their classes.
- Search also finds methods and attributes; Ctrl+Enter opens a result in the editor.
- The diagram scans again when a C++ file of its folder is saved (setting `classScanner.rescanOnSave`).
- Ctrl + click adds a class to the selection or removes it; Alt + click now opens the class declaration.
- The schema for an LLM can be made lighter (without private members, public members only, no members, without file locations), with an estimate of its size in tokens.
- The source archive finds the .cpp file of a header in more project layouts, such as `include/myproject/x.h` with `src/x.cpp`.
- The scan depth is asked the first time only; the new "Change Scan Depth" command and the Depth button change it.

- Thinner relation lines, arrow heads and diamonds.
- The relations that are turned on stay visible at every zoom level, instead of being merged between groups when zoomed out. Dense sets of relations are drawn more transparent.
- New "Zoomed out" switches in the side panel: "Simplify cards" (turn it off to keep full cards at every zoom level) and "Merge relations" (turn it on to merge the relations between groups when zoomed out).

## 0.1.1

- Extension icon.
- Rewritten extension page: quick start, features with screenshots, commands, settings.

## 0.1.0

First version.

- Scan a folder of `.cpp`, `.hpp` and `.h` files, with a depth limit, without any build configuration.
- Classes, structs, unions, enums and templates, with their members.
- Seven relation kinds, each with its own switch: inheritance, composition, aggregation, dependency, include, friend and nesting.
- WebGL diagram with semantic zoom, smooth beyond 1000 classes.
- Three layouts: grouped by namespace, folder or file with collapsible groups; global hierarchy; organic.
- Cards can be moved and pinned to a compact or full view; the arrangement is saved in the workspace.
- Go to source, search, filters, neighborhood focus and isolation, minimap.
- Rectangle selection with Ctrl + drag.
- Exports: PNG and SVG images, a compact schema for language models, and the sources of the selected classes as a `.zip` archive.
- "Liquid glass" interface that follows the VS Code theme.
