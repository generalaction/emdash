export function clipboardHasText(data: Pick<DataTransfer, 'types'>): boolean {
  return data.types.some((type) => {
    const normalized = type.toLowerCase();
    return normalized === 'text/plain' || normalized === 'text/html';
  });
}

export function imageFilesFromClipboard(data: Pick<DataTransfer, 'items'>): File[] {
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
