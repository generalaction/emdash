'use client';

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { cx } from '@styles/utilities/cx';
import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';
import * as styles from './collapsible.css';

// ── Root ──────────────────────────────────────────────────────────────────────

/**
 * Collapsible — wraps a trigger and an animated panel.
 *
 * Uncontrolled:  `<Collapsible defaultOpen>`
 * Controlled:    `<Collapsible open={open} onOpenChange={setOpen}>`
 * Disabled:      `<Collapsible disabled>`
 */
function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

// ── Trigger ───────────────────────────────────────────────────────────────────

export interface CollapsibleTriggerProps extends CollapsiblePrimitive.Trigger.Props {
  /** Hide the trailing chevron icon. @default false */
  hideChevron?: boolean;
}

/**
 * CollapsibleTrigger — full-width ghost button.
 * The trailing chevron rotates 180° when the panel opens.
 * Use `data-panel-open` from the base-ui context for custom rendering if needed.
 */
function CollapsibleTrigger({
  className,
  hideChevron = false,
  children,
  ...props
}: CollapsibleTriggerProps) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cx(styles.trigger, className)}
      {...props}
    >
      {children}
      {!hideChevron && <ChevronDownIcon className={styles.chevron} aria-hidden />}
    </CollapsiblePrimitive.Trigger>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

/**
 * CollapsiblePanel — animated height panel.
 *
 * Uses base-ui's `--collapsible-panel-height` CSS variable for the open height
 * and `data-starting-style` / `data-ending-style` for enter/exit transitions.
 *
 * Pass `keepMounted` to preserve DOM state while hidden (e.g. forms, iframes).
 * Pass `hiddenUntilFound` to enable browser in-page search within the panel.
 */
function CollapsiblePanel({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={cx(styles.panel, className)}
      {...props}
    />
  );
}

export { Collapsible, CollapsiblePanel, CollapsibleTrigger };
