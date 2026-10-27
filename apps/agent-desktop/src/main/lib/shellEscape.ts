/**
 * Validates that a string is a safe POSIX environment variable name.
 * Must start with a letter or underscore, followed by letters, digits, or underscores.
 */
export function isValidEnvVarName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
