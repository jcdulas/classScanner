// Removes macros that would otherwise break the parsing of class declarations (spec §2.4).
//
// tree-sitter does not run the C preprocessor, so it does not know that
// `MYLIB_API` in `class MYLIB_API Foo : public Bar` expands to nothing (or to
// `__declspec(dllexport)`). It then misreads the whole declaration. To avoid
// that, macros are replaced with spaces before parsing. Replacing with spaces
// instead of deleting keeps every line and column unchanged, so the line
// numbers reported to the user still match the original file.

/**
 * An all-caps identifier between `class`, `struct` or `union` and the class name.
 * Two identifiers in a row are not valid C++ there, so the first one must be a macro.
 * The lookahead checks that a class name follows, then a base list, a body, or template arguments.
 */
const EXPORT_MACRO_PATTERN = /\b(?:class|struct|union)\s+([A-Z][A-Z0-9_]*[A-Z0-9])(?=\s+(?!final\b)[A-Za-z_]\w*\s*(?:final\b|[:{<]))/g;

export function stripMacros(sourceText: string, ignoredMacros: string[]): string {
  let text = sourceText;
  for (const macroName of ignoredMacros) {
    text = blankOutConfiguredMacro(text, macroName);
  }
  return blankOutExportMacros(text);
}

function blankOutConfiguredMacro(text: string, macroName: string): string {
  // The macro, optionally followed by a parenthesized argument list without nested parentheses.
  const pattern = new RegExp(`\\b${escapeRegExp(macroName)}\\b(?:\\s*\\([^()]*\\))?`, 'g');
  return text.replace(pattern, (match) => blankOut(match));
}

function blankOutExportMacros(text: string): string {
  return text.replace(EXPORT_MACRO_PATTERN, (match, macroName: string) => {
    const macroStart = match.lastIndexOf(macroName);
    return match.slice(0, macroStart) + blankOut(macroName);
  });
}

/** Replaces every character with a space, except line breaks. */
function blankOut(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
