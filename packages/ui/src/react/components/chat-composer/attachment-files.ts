export function clipboardHasText(data: Pick<DataTransfer, 'types'>): boolean {
  return data.types.some((type) => {
    const normalized = type.toLowerCase();
    return normalized === 'text/plain' || normalized === 'text/html';
  });
}

const imageFileExtension = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;

export function imageFilesFromClipboard(data: Pick<DataTransfer, 'items'>): File[] {
  // Chromium normalizes a copied image's native alternate representations before
  // dispatching the paste event, so each file item here represents a distinct file.
  return Array.from(data.items).flatMap((item) => {
    if (item.kind !== 'file') return [];
    const file = item.getAsFile();
    if (!file) return [];
    const mimeType = (item.type || file.type).toLowerCase();
    return mimeType.startsWith('image/') || imageFileExtension.test(file.name) ? [file] : [];
  });
}
