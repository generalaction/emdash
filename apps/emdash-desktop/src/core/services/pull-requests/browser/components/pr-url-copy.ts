import { toast } from '@emdash/ui/react/primitives';
import { copyTextToClipboard } from '@core/primitives/desktop-host/browser/host-client';

export async function copyPrUrl(url: string, provider = 'github'): Promise<boolean> {
  const short = provider === 'gitlab' ? 'MR' : 'PR';
  try {
    const result = await copyTextToClipboard(url);
    if (!result.success) {
      showCopyFailure(short);
      return false;
    }

    toast(`${short} URL copied`);
    return true;
  } catch {
    showCopyFailure(short);
    return false;
  }
}

function showCopyFailure(short: string): void {
  toast.error('Copy failed', {
    description: `The ${short} URL could not be copied to the clipboard.`,
  });
}
