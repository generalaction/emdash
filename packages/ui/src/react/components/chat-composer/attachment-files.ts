export function clipboardHasText(data: Pick<DataTransfer, 'types'>): boolean {
  return data.types.some((type) => {
    const normalized = type.toLowerCase();
    return normalized === 'text/plain' || normalized === 'text/html';
  });
}

const preferredImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function imageNameStem(file: File): string {
  const extensionIndex = file.name.lastIndexOf('.');
  return (extensionIndex > 0 ? file.name.slice(0, extensionIndex) : file.name).toLowerCase();
}

function preferredImageFile(files: File[]): File {
  return files.reduce((preferred, candidate) => {
    const preferredRank = preferredImageTypes.indexOf(preferred.type.toLowerCase());
    const candidateRank = preferredImageTypes.indexOf(candidate.type.toLowerCase());
    const normalizedPreferredRank =
      preferredRank === -1 ? preferredImageTypes.length : preferredRank;
    const normalizedCandidateRank =
      candidateRank === -1 ? preferredImageTypes.length : candidateRank;
    return normalizedCandidateRank < normalizedPreferredRank ? candidate : preferred;
  });
}

export function imageFilesFromClipboard(data: Pick<DataTransfer, 'items' | 'types'>): File[] {
  const files = Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);

  if (!data.types.some((type) => type.toLowerCase().startsWith('image/'))) return files;

  const groups = new Map<string, File[]>();
  files.forEach((file, index) => {
    const stem = imageNameStem(file);
    const key = stem || `clipboard-image-${index}`;
    const group = groups.get(key);
    if (group) group.push(file);
    else groups.set(key, [file]);
  });

  return Array.from(groups.values()).flatMap((group) => {
    const distinctTypes = new Set(group.map((file) => file.type.toLowerCase()));
    if (group.length > 1 && distinctTypes.size === group.length) {
      return [preferredImageFile(group)];
    }
    return group;
  });
}
