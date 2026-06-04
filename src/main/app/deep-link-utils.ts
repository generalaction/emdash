export function findDeepLinkInArgv(argv: string[], scheme: string): string | null {
  return argv.find((arg) => isDeepLinkUrl(arg, scheme)) ?? null;
}

export function isDeepLinkUrl(value: string, scheme: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === `${scheme}:`;
  } catch {
    return false;
  }
}
