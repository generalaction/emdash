/** Joins internal class inputs while ignoring Base UI render callbacks. */
export function joinClassNames(...inputs: unknown[]): string {
  const classNames: string[] = [];
  for (const input of inputs) {
    if (typeof input === 'string') {
      classNames.push(input);
    } else if (Array.isArray(input)) {
      const nested = joinClassNames(...input);
      if (nested) classNames.push(nested);
    }
  }
  return classNames.join(' ');
}
