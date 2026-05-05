/**
 * POSIX shell escaping utility.
 *
 * Uses single-quote wrapping, which prevents variable expansion, command substitution,
 * and globbing. Embedded single quotes are handled by closing and reopening the quote.
 */
export function quoteShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
