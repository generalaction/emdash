import { Toaster as SonnerToaster } from 'sonner';
import { useTheme } from '@renderer/lib/hooks/useTheme';

export const FEATURE_ANNOUNCEMENT_TOASTER_ID = 'feature-announcements';

export function FeatureAnnouncementToaster() {
  const { effectiveTheme } = useTheme();
  const theme = effectiveTheme === 'emlight' ? 'light' : 'dark';

  return (
    <SonnerToaster
      id={FEATURE_ANNOUNCEMENT_TOASTER_ID}
      theme={theme}
      position="bottom-left"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: 'group toast !border-none !bg-transparent !p-0 !shadow-none',
        },
      }}
    />
  );
}
