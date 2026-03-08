export function stripAnsi(data: string): string {
  return data
    .replace(/\x1b\[[\x20-\x3F]*[\x40-\x7E]/g, '')
    .replace(/\x1b\][\s\S]*?(\x07|\x1b\\)/g, '');
}
