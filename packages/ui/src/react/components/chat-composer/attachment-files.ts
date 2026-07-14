export function clipboardHasText(data: Pick<DataTransfer, 'types'>): boolean {
  return data.types.some((type) => {
    const normalized = type.toLowerCase();
    return normalized === 'text/plain' || normalized === 'text/html';
  });
}

const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function imageFilesFromClipboard(data: Pick<DataTransfer, 'items' | 'types'>): File[] {
  const files = Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  if (!data.types.some((type) => type.toLowerCase().startsWith('image/'))) return files;

  const supportedFiles = files.filter((file) => supportedImageTypes.has(file.type.toLowerCase()));
  return supportedFiles.length > 0 ? supportedFiles : files;
}
