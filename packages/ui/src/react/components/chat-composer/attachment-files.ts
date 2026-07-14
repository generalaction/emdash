export function imageFilesFromClipboard(data: Pick<DataTransfer, 'items' | 'types'>): File[] {
  const files = Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  if (!data.types.some((type) => type.toLowerCase().startsWith('image/'))) return files;
  const preferredOrder = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  files.sort((a, b) => {
    const aRank = preferredOrder.indexOf(a.type.toLowerCase());
    const bRank = preferredOrder.indexOf(b.type.toLowerCase());
    return (
      (aRank === -1 ? preferredOrder.length : aRank) -
      (bRank === -1 ? preferredOrder.length : bRank)
    );
  });
  return files.slice(0, 1);
}
