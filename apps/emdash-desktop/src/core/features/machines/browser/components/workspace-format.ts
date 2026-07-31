export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(1)} ${units[index]}`;
}

export function basename(value: string): string {
  const normalized = value.replace(/\\/gu, '/').replace(/\/+$/u, '');
  return normalized.split('/').at(-1) ?? value;
}
