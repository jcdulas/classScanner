// Reads the text of functions for the requests to the C++ language extension
// (preciseCalls.ts, spec §3.3): where the name of a function is on a line of
// code, and the plain name in the name that the language extension displays.
// No VS Code API here, so that it runs in the unit tests.

/**
 * Where the name of a function is on a line of code: the name as a whole word, followed by its
 * parameters. `get` is found in `Widget* get() const`, not inside `Widget`.
 */
export function columnOfFunctionName(lineText: string, name: string): number | undefined {
  // The characters of an operator name, such as `operator+`, have a meaning in a regular expression.
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(^|[^\\w~])(${escapedName})\\s*\\(`).exec(lineText);
  return match === null ? undefined : match.index + match[1].length;
}

/** `area() const` and `Shape::area(int)` both give `area`: the name without its class and its parameters. */
export function plainFunctionName(displayName: string): string {
  // The last pair of parentheses holds the parameters; what follows it is a qualifier such as `const`.
  const withoutParameters = displayName.replace(/\([^()]*\)[^()]*$/, '').trim();
  const classEnd = withoutParameters.lastIndexOf('::');
  return classEnd < 0 ? withoutParameters : withoutParameters.slice(classEnd + 2);
}
