/** Split a file path into filename and directory parts. */
export function splitPath(filePath: string): { filename: string; directory: string } {
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash === -1) {
    return { filename: filePath, directory: '' };
  }
  return {
    filename: filePath.slice(lastSlash + 1),
    directory: filePath.slice(0, lastSlash),
  };
}
