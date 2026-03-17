export function splitRepo(nameWithOwner: string): { owner: string; repo: string } {
  const idx = nameWithOwner.indexOf('/');
  if (idx === -1) {
    throw new Error(`Invalid nameWithOwner: "${nameWithOwner}" (expected "owner/repo")`);
  }
  return { owner: nameWithOwner.slice(0, idx), repo: nameWithOwner.slice(idx + 1) };
}
