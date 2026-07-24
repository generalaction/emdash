import { toast } from '@core/primitives/ui/browser/use-toast';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';

export async function copyPrUrl(url: string): Promise<boolean> {
  try {
    const result = await rpc.app.clipboardWriteText(url);
    if (!result.success) {
      showCopyFailure();
      return false;
    }

    toast({ title: 'PR URL copied' });
    return true;
  } catch {
    showCopyFailure();
    return false;
  }
}

function showCopyFailure(): void {
  toast({
    title: 'Copy failed',
    description: 'The PR URL could not be copied to the clipboard.',
    variant: 'destructive',
  });
}
