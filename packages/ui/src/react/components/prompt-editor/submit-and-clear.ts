export async function submitAndClearUnchanged(
  text: string,
  version: number,
  submit: (text: string) => boolean | void | Promise<boolean | void>,
  getCurrentVersion: () => number,
  clear: () => void
) {
  try {
    const accepted = await submit(text);
    if (accepted !== false && getCurrentVersion() === version) clear();
  } catch {
    // Keep the prompt available for retry when asynchronous preparation fails.
  }
}
