const supportedAcpImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function isSupportedAcpImageMimeType(value: string) {
  return supportedAcpImageMimeTypes.has(value.toLowerCase());
}

export function partitionAcpImageFiles(files: File[]) {
  const supported: File[] = [];
  const unsupported: File[] = [];
  for (const file of files) {
    (isSupportedAcpImageMimeType(file.type) ? supported : unsupported).push(file);
  }
  return { supported, unsupported };
}
