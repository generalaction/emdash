export function normalizeMcpUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return value;
  }
}
