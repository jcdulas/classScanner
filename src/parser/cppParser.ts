// Loads tree-sitter and its C++ grammar, and parses C++ source text.
//
// tree-sitter is a parser generator: `tree-sitter-cpp.wasm` contains a
// compiled C++ grammar, and `web-tree-sitter.wasm` the runtime that executes
// it. Both are WebAssembly, so no native module has to be built. The result
// of a parse is a syntax tree whose nodes have a `type` such as
// `class_specifier`, and named fields such as `name` or `body`. The tree
// lives in WebAssembly memory and must be released with `tree.delete()`.

import { Language, Parser, Tree } from 'web-tree-sitter';

export interface WasmPaths {
  /** Path of `web-tree-sitter.wasm`, the tree-sitter runtime. */
  runtime: string;
  /** Path of `tree-sitter-cpp.wasm`, the C++ grammar. */
  cppGrammar: string;
}

// The runtime must be initialized once per thread, before any parser is created.
let runtimeInitialization: Promise<void> | undefined;

function initializeRuntime(runtimeWasmPath: string): Promise<void> {
  if (runtimeInitialization === undefined) {
    runtimeInitialization = Parser.init({
      locateFile: () => runtimeWasmPath,
    });
  }
  return runtimeInitialization;
}

export class CppParser {
  private constructor(private readonly parser: Parser) {}

  static async create(wasmPaths: WasmPaths): Promise<CppParser> {
    await initializeRuntime(wasmPaths.runtime);
    const language = await Language.load(wasmPaths.cppGrammar);
    const parser = new Parser();
    parser.setLanguage(language);
    return new CppParser(parser);
  }

  /** Parses C++ source text. The caller must call `delete()` on the returned tree. */
  parse(sourceText: string): Tree {
    const tree = this.parser.parse(sourceText);
    if (tree === null) {
      throw new Error('tree-sitter returned no syntax tree');
    }
    return tree;
  }
}
