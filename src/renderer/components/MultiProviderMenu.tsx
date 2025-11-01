import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { type Provider } from '../types';
import openaiLogo from '../../assets/images/openai.png';
import claudeLogo from '../../assets/images/claude.png';
import factoryLogo from '../../assets/images/factorydroid.png';
import geminiLogo from '../../assets/images/gemini.png';
import cursorLogo from '../../assets/images/cursorlogo.png';
import copilotLogo from '../../assets/images/ghcopilot.png';
import ampLogo from '../../assets/images/ampcode.png';
import opencodeLogo from '../../assets/images/opencode.png';
import charmLogo from '../../assets/images/charm.png';
import qwenLogo from '../../assets/images/qwen.png';
import augmentLogo from '../../assets/images/augmentcode.png';
import gooseLogo from '../../assets/images/goose.png';

type ProviderInfo = { name: string; logo: string; alt: string; invertInDark?: boolean };

const providerConfig: Record<Provider, ProviderInfo> = {
  codex: { name: 'Codex', logo: openaiLogo, alt: 'Codex', invertInDark: true },
  qwen: { name: 'Qwen Code', logo: qwenLogo, alt: 'Qwen Code' },
  claude: { name: 'Claude Code', logo: claudeLogo, alt: 'Claude Code' },
  droid: { name: 'Droid', logo: factoryLogo, alt: 'Factory Droid', invertInDark: true },
  gemini: { name: 'Gemini', logo: geminiLogo, alt: 'Gemini CLI' },
  cursor: { name: 'Cursor', logo: cursorLogo, alt: 'Cursor CLI', invertInDark: true },
  copilot: { name: 'Copilot', logo: copilotLogo, alt: 'GitHub Copilot CLI', invertInDark: true },
  amp: { name: 'Amp', logo: ampLogo, alt: 'Amp Code' },
  opencode: { name: 'OpenCode', logo: opencodeLogo, alt: 'OpenCode', invertInDark: true },
  charm: { name: 'Charm', logo: charmLogo, alt: 'Charm' },
  auggie: { name: 'Auggie', logo: augmentLogo, alt: 'Auggie CLI' },
  goose: { name: 'Goose', logo: gooseLogo, alt: 'Goose CLI' },
};

interface Props {
  value: Provider[];
  onChange: (next: Provider[]) => void;
  max?: number;
  className?: string;
}

const MultiProviderMenu: React.FC<Props> = ({ value, onChange, max = 4, className = '' }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = new Set(value);
  const toggle = (p: Provider) => {
    const next = new Set(selected);
    if (next.has(p)) next.delete(p);
    else {
      if (next.size >= max) return;
      next.add(p);
    }
    onChange(Array.from(next));
  };

  const count = value.length;
  const names = value.map((id) => providerConfig[id]?.name).filter(Boolean);
  const label = count === 0 ? 'Select providers' : names.join(', ');
  const primary = value[0];
  const primaryInfo = primary ? providerConfig[primary] : null;
  const icons = count > 1 ? value.slice(0, 4).map((id) => providerConfig[id]).filter(Boolean) : [];

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-9 w-full rounded-md border-none bg-gray-100 px-2 text-left dark:bg-gray-700"
        aria-haspopup
        aria-expanded={open}
      >
        <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
          {count <= 1 ? (
            primaryInfo ? (
              <>
                <img
                  src={primaryInfo.logo}
                  alt={primaryInfo.alt}
                  className={`h-4 w-4 shrink-0 shadow-xs rounded-sm ${primaryInfo.invertInDark ? 'dark:invert' : ''}`}
                />
                <span className="flex-1 truncate text-sm text-foreground">{label}</span>
              </>
            ) : (
              <span className="flex-1 truncate text-sm text-foreground">{label}</span>
            )
          ) : (
            <>
              <div className="relative flex items-center">
                {icons.map((info, idx) => (
                  <img
                    key={`${info.alt}-${idx}`}
                    src={info.logo}
                    alt={info.alt}
                    className={[
                      idx === 0
                        ? 'h-4 w-4'
                        : 'h-[13px] w-[13px] opacity-95',
                      'rounded-sm ring-1 ring-border',
                      info.invertInDark ? 'dark:invert' : '',
                    ].join(' ')}
                    style={{ marginLeft: idx === 0 ? 0 : -6, zIndex: 10 - idx }}
                  />
                ))}
              </div>
              <span className="flex-1 truncate text-sm text-foreground">{label}</span>
            </>
          )}
          <ChevronDown
            className={`ml-1 h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
            style={{ transformOrigin: 'top right' }}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 4, scale: 0.98 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {(Object.keys(providerConfig) as Provider[]).map((id) => {
              const info = providerConfig[id];
              const active = selected.has(id);
              return (
                <label
                  key={id}
                  className={`flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm shadow-xs hover:bg-accent hover:text-accent-foreground ${
                    active ? 'bg-accent/40' : ''
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(id)}
                >
                  <input type="checkbox" checked={active} readOnly className="h-3.5 w-3.5" />
                  <img
                    src={info.logo}
                    alt={info.alt}
                    className={`h-4 w-4 rounded-sm ${info.invertInDark ? 'dark:invert' : ''}`}
                  />
                  <span className="truncate">{info.name}</span>
                </label>
              );
            })}
            <div className="px-1 py-1 text-right">
              <button
                className="rounded border border-border bg-background px-2 py-1 text-xs"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MultiProviderMenu;
