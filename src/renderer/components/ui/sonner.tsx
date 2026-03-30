import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@renderer/hooks/useTheme';

export function Toaster() {
  const { effectiveTheme } = useTheme();
  const theme = effectiveTheme === 'emlight' ? 'light' : 'dark';

  return (
    <SonnerToaster
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast bg-background text-foreground border border-border shadow-lg',
          description: 'text-muted-foreground',
          actionButton: 'bg-primary text-primary-foreground',
          cancelButton: 'bg-muted text-muted-foreground',
          error: 'text-destructive border-destructive/50',
        },
      }}
    />
  );
}
