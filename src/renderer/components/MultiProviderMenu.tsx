import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { type Provider } from '../types';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { ProviderInfoCard } from './ProviderInfoCard';
import type { UiProvider } from '@/providers/meta';
import { providerConfig } from '../lib/providerConfig';

interface Props {
  value: Provider[];
  onChange: (next: Provider[]) => void;
  max?: number;
  className?: string;
}

const MultiProviderMenu: React.FC<Props> = ({ value, onChange, max = 4, className = '' }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = React.useState<'bottom' | 'top'>('bottom');
  const [coords, setCoords] = React.useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });
  const shouldReduceMotion = useReducedMotion();
  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!ref.current) return;
      if (target && (ref.current.contains(target) || menuRef.current?.contains(target))) {
        return;
      }
      setOpen(false);
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
  const icons =
    count > 1
      ? value
          .slice(0, 4)
          .map((id) => providerConfig[id])
          .filter(Boolean)
      : [];

  const updatePosition = React.useCallback(() => {
    if (!open) return;
    const trigger = ref.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    let nextPlacement: 'bottom' | 'top' = 'bottom';
    if (spaceAbove >= menuRect.height + padding) nextPlacement = 'top';
    if (spaceBelow >= menuRect.height + padding && spaceBelow > spaceAbove)
      nextPlacement = 'bottom';

    const top =
      nextPlacement === 'bottom'
        ? triggerRect.bottom + padding
        : triggerRect.top - menuRect.height - padding;

    setPlacement(nextPlacement);
    setCoords({ top, left: triggerRect.left, width: triggerRect.width });
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open) return;
    requestAnimationFrame(updatePosition);
  }, [open, value.length, updatePosition]);

  React.useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [open, updatePosition]);

  return (
    <div ref={ref} className={`relative ${className}`} style={{ zIndex: 150 }}>
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
                  className={`shadow-xs h-4 w-4 shrink-0 rounded-sm ${primaryInfo.invertInDark ? 'dark:invert' : ''}`}
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
                  <div
                    key={`${info.alt}-${idx}`}
                    className={[
                      idx === 0 ? 'h-4 w-4' : 'h-[13px] w-[13px] opacity-95',
                      'rounded-sm bg-transparent',
                    ].join(' ')}
                    style={{ marginLeft: idx === 0 ? 0 : -6, zIndex: 10 - idx }}
                  >
                    <img
                      src={info.logo}
                      alt={info.alt}
                      className={[
                        info.invertInDark ? 'dark:invert' : '',
                        'h-full w-full rounded-sm object-contain',
                      ].join(' ')}
                    />
                  </div>
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
      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open && (
                <motion.div
                  ref={menuRef}
                  role="menu"
                  className="fixed z-[9999] max-h-64 w-[var(--menu-width)] overflow-auto rounded-md border border-border bg-popover p-1 shadow-md"
                  style={
                    {
                      '--menu-width': `${coords.width}px`,
                      top: coords.top,
                      left: coords.left,
                      transformOrigin: placement === 'bottom' ? 'top right' : 'bottom right',
                    } as React.CSSProperties
                  }
                  initial={
                    shouldReduceMotion
                      ? false
                      : { opacity: 0, y: placement === 'bottom' ? 6 : -6, scale: 0.98 }
                  }
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={
                    shouldReduceMotion
                      ? { opacity: 1, y: 0, scale: 1 }
                      : { opacity: 0, y: placement === 'bottom' ? 4 : -4, scale: 0.98 }
                  }
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
                  }
                >
                  <TooltipProvider delayDuration={150}>
                    {(Object.keys(providerConfig) as Provider[]).map((id) => {
                      const info = providerConfig[id];
                      const active = selected.has(id);
                      return (
                        <MultiTooltipRow key={id} id={id}>
                          <label
                            className={`shadow-xs flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm hover:bg-accent hover:text-accent-foreground ${
                              active ? 'bg-accent/40' : ''
                            }`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => toggle(id)}
                          >
                            <input
                              type="checkbox"
                              checked={active}
                              readOnly
                              className="h-3.5 w-3.5"
                            />
                            <img
                              src={info.logo}
                              alt={info.alt}
                              className={`h-4 w-4 rounded-sm ${info.invertInDark ? 'dark:invert' : ''}`}
                            />
                            <span className="truncate">{info.name}</span>
                          </label>
                        </MultiTooltipRow>
                      );
                    })}
                  </TooltipProvider>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )
        : null}
    </div>
  );
};

const MultiTooltipRow: React.FC<{ id: Provider; children: React.ReactElement }> = ({
  id,
  children,
}) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Tooltip open={open}>
      <TooltipTrigger asChild>
        {React.cloneElement(children, {
          onMouseEnter: () => setOpen(true),
          onMouseLeave: () => setOpen(false),
          onPointerEnter: () => setOpen(true),
          onPointerLeave: () => setOpen(false),
        })}
      </TooltipTrigger>
      <TooltipContent
        side="right"
        align="start"
        className="border-foreground/20 bg-background p-0 text-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
      >
        <ProviderInfoCard id={id as UiProvider} />
      </TooltipContent>
    </Tooltip>
  );
};

export default MultiProviderMenu;
