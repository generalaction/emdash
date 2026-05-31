export function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes('Files');
}

export function getDraggedFilePaths(dataTransfer: DataTransfer): string[] {
  return Array.from(dataTransfer.files)
    .map((file) => window.electronAPI.getPathForFile(file).trim())
    .filter(Boolean);
}
