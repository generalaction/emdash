import { detectPlatform, matchesKeyboardEvent } from '@tanstack/react-hotkeys';
import { motion, type Variants } from 'framer-motion';
import { useEffect } from 'react';
import IconLight from '@/assets/images/emdash/icon-light.png';
import YTBanner from '@/assets/images/ytbanner.webp';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { Button } from '@renderer/lib/ui/button';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';

const PLATFORM = detectPlatform();

interface WelcomeScreenProps {
  onGetStarted: () => void;
}

export function WelcomeScreen({ onGetStarted }: WelcomeScreenProps) {
  const { effectiveTheme } = useTheme();
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const confirmHotkey = getEffectiveHotkey('confirm', keyboard);

  useEffect(() => {
    if (confirmHotkey === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesKeyboardEvent(event, confirmHotkey, PLATFORM)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onGetStarted();
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [confirmHotkey, onGetStarted]);

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.3,
        delayChildren: 0.7,
      },
    },
  };

  const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.9,
        ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number], // Properly typed cubic-bezier
      },
    },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="absolute right-0 bottom-0 left-0 h-3/5">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: `url(${YTBanner})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            maskImage:
              'linear-gradient(to bottom, transparent 0%, transparent 30%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.8) 100%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0%, transparent 30%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0.8) 100%)',
          }}
        />
      </div>

      <motion.div
        className="relative z-10 flex flex-col items-center justify-center space-y-4 p-8"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          className="rounded-md border border-border/40 bg-white p-1.5 shadow-lg ring-1 shadow-black/5 ring-black/5 dark:shadow-white/5 dark:ring-white/10"
          variants={itemVariants}
        >
          <img src={IconLight} alt="Emdash" className="h-12 w-12 rounded-sm" />
        </motion.div>

        <motion.h1
          className="text-lg font-semibold tracking-tight text-foreground"
          variants={itemVariants}
        >
          Welcome.
        </motion.h1>

        <motion.div
          variants={itemVariants}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.1, ease: 'easeInOut' }}
        >
          <Button
            onClick={onGetStarted}
            size="sm"
            className={
              effectiveTheme === 'emdark' ? 'bg-gray-200 text-gray-900 hover:bg-gray-300' : ''
            }
          >
            <span className="flex items-center gap-2">
              Start shipping
              <BoundShortcut settingsKey="confirm" />
            </span>
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
