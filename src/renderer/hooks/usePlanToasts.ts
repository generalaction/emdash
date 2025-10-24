import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function usePlanToasts() {
  const { toast } = useToast();

  useEffect(() => {
    const off = (window as any).electronAPI.onPlanEvent?.((evt: any) => {
      if (!evt || !evt.type) return;
      if (evt.type === 'write_blocked') {
        toast({
          title: 'Write blocked by Plan Mode',
          description: `${evt.relPath} could not be written while Plan Mode is enabled.`,
          variant: 'destructive',
        });
      } else if (evt.type === 'remove_blocked') {
        toast({
          title: 'Delete blocked by Plan Mode',
          description: `${evt.relPath} could not be removed while Plan Mode is enabled.`,
          variant: 'destructive',
        });
      }
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [toast]);
}
