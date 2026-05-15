import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
export const PANEL_WIDTH = 480;

interface AutomationPanelShellProps {
  open: boolean;
  children: ReactNode;
}

export function AutomationPanelShell({ open, children }: AutomationPanelShellProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? PANEL_WIDTH : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.28, ease: PANEL_EASE }}
      className="relative shrink-0 overflow-hidden border-l border-border bg-background"
      aria-hidden={!open}
    >
      <div
        className="absolute inset-y-0 right-0 flex h-full flex-col"
        style={{ width: PANEL_WIDTH }}
      >
        {children}
      </div>
    </motion.aside>
  );
}
