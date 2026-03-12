export type RevertFileOps = {
  normalizeFilePath: (filePath: string) => string;
  existsInHead: (filePath: string) => Promise<boolean>;
  deleteUntracked: (filePath: string) => Promise<void>;
  checkoutHead: (filePath: string) => Promise<void>;
};

export async function revertFileShared(
  filePath: string,
  ops: RevertFileOps
): Promise<{ action: 'reverted' }> {
  const safePath = ops.normalizeFilePath(filePath);
  const existsInHead = await ops.existsInHead(safePath);
  if (!existsInHead) {
    await ops.deleteUntracked(safePath);
    return { action: 'reverted' };
  }

  await ops.checkoutHead(safePath);
  return { action: 'reverted' };
}
