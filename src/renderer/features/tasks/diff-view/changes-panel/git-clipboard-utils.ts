import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';

export async function copyRelativePaths(paths: string[]) {
  try {
    await rpc.app.clipboardWriteText(paths.join('\n'));
    toast({ title: paths.length > 1 ? 'Relative paths copied' : 'Relative path copied' });
  } catch (error) {
    toast({
      title: 'Copy failed',
      description: error instanceof Error ? error.message : 'The path could not be copied.',
      variant: 'destructive',
    });
  }
}
