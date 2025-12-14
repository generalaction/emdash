import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { useToast } from '@/hooks/use-toast';
import cursorLogo from '../../../assets/images/cursorlogo.png';
import finderLogo from '../../../assets/images/finder.png';
import terminalLogo from '../../../assets/images/terminal.png';
import zedLogo from '../../../assets/images/zed.png';
import ghosttyLogo from '../../../assets/images/ghostty.png';
import vscodeLogo from '../../../assets/images/vscode.png';
import iterm2Logo from '../../../assets/images/iterm2.png';
import warpLogo from '../../../assets/images/warp.svg';

interface OpenInMenuProps {
  path: string;
  align?: 'left' | 'right';
}

const menuItemBase =
  'flex w-full cursor-pointer select-none items-center gap-2 rounded px-2.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground';

const OpenInMenu: React.FC<OpenInMenuProps> = ({ path, align = 'right' }) => {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();

  React.useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const callOpen = async (
    app: 'finder' | 'cursor' | 'vscode' | 'terminal' | 'ghostty' | 'zed' | 'iterm2' | 'warp'
  ) => {
    void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('toolbar_open_in_selected', { app });
    });
    try {
      const res = await (window as any).electronAPI?.openIn?.({ app, path });
      if (!res?.success) {
        const pretty =
          app === 'ghostty'
            ? 'Ghostty'
            : app === 'zed'
              ? 'Zed'
              : app === 'vscode'
                ? 'VS Code'
                : app === 'iterm2'
                  ? 'iTerm2'
                  : app === 'warp'
                    ? 'Warp'
                    : app;
        toast({
          title: `Open in ${pretty} failed`,
          description:
            res?.error ||
            (app === 'ghostty'
              ? 'Ghostty is not installed or not available on this platform.'
              : app === 'zed'
                ? 'Zed is not installed or not available on this platform.'
                : app === 'iterm2'
                  ? 'iTerm2 is not installed or not available on this platform.'
                  : app === 'warp'
                    ? 'Warp is not installed or not available on this platform.'
                    : 'Application not available.'),
          variant: 'destructive',
        });
      }
    } catch (e: any) {
      const pretty =
        app === 'ghostty'
          ? 'Ghostty'
          : app === 'zed'
            ? 'Zed'
            : app === 'vscode'
              ? 'VS Code'
              : app === 'iterm2'
                ? 'iTerm2'
                : app === 'warp'
                  ? 'Warp'
                  : app;
      toast({
        title: `Open in ${pretty} failed`,
        description: e?.message || String(e),
        variant: 'destructive',
      });
    }
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-2 text-muted-foreground hover:bg-background/80"
        onClick={async () => {
          const newState = !open;
          void import('../../lib/telemetryClient').then(({ captureTelemetry }) => {
            captureTelemetry('toolbar_open_in_menu_clicked', {
              state: newState ? 'open' : 'closed',
            });
          });
          setOpen(newState);
        }}
        aria-expanded={open}
        aria-haspopup
      >
        <span>Open in</span>
        <ChevronDown
          className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className={[
              'absolute z-50 mt-1 min-w-[180px] rounded-md border border-border bg-popover p-1 shadow-md',
              align === 'right' ? 'right-0' : 'left-0',
            ].join(' ')}
            style={{ transformOrigin: align === 'right' ? 'top right' : 'top left' }}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 4, scale: 0.98 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
            }
          >
            <button className={menuItemBase} role="menuitem" onClick={() => callOpen('finder')}>
              <img src={finderLogo} alt="Finder" className="h-4 w-4 rounded" />
              <span>Finder</span>
            </button>
            <button className={menuItemBase} role="menuitem" onClick={() => callOpen('cursor')}>
              <img src={cursorLogo} alt="Cursor" className="h-4 w-4" />
              <span>Cursor</span>
            </button>
            <button className={menuItemBase} role="menuitem" onClick={() => callOpen('vscode')}>
              <img src={vscodeLogo} alt="VS Code" className="h-4 w-4 rounded" />
              <span>VS Code</span>
            </button>
            <button className={menuItemBase} role="menuitem" onClick={() => callOpen('terminal')}>
              <img src={terminalLogo} alt="Terminal" className="h-4 w-4 rounded" />
              <span>Terminal</span>
            </button>
            <button className={menuItemBase} role="menuitem" onClick={() => callOpen('warp')}>
              <img src={warpLogo} alt="Warp" className="h-4 w-4 rounded" />
              <span>Warp</span>
            </button>
            <button className={menuItemBase} role="menuitem" onClick={() => callOpen('iterm2')}>
              <img src={iterm2Logo} alt="iTerm2" className="h-4 w-4 rounded" />
              <span>iTerm2</span>
            </button>
            <button className={menuItemBase} role="menuitem" onClick={() => callOpen('ghostty')}>
              <img src={ghosttyLogo} alt="Ghostty" className="h-4 w-4 rounded" />
              <span>Ghostty</span>
            </button>
            <button className={menuItemBase} role="menuitem" onClick={() => callOpen('zed')}>
              <img src={zedLogo} alt="Zed" className="h-4 w-4 rounded" />
              <span>Zed</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default OpenInMenu;
