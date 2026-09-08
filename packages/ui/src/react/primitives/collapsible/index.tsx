'use client';

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { joinClassNames as cx } from '@styles/classnames';
import { control } from '@styles/recipes/control';
import { ChevronDownIcon } from 'lucide-react';
import * as React from 'react';
import type { ControlSize, ControlTone } from '../../../styles/recipes/control';
import { Icon } from '../icon';
import * as styles from './collapsible.css';

// ── Root ──────────────────────────────────────────────────────────────────────

/** `className` is applied to the rendered Collapsible state root. */
function CollapsibleRoot({ className, ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root {...props} data-slot="collapsible" className={className} />;
}

// ── Trigger ───────────────────────────────────────────────────────────────────

export interface CollapsibleTriggerProps extends Omit<
  CollapsiblePrimitive.Trigger.Props,
  'className'
> {
  /**
   * Applies caller-owned classes to the rendered trigger root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /** Shared four-step control size. @default 'base' */
  size?: ControlSize;
  /** Semantic status intent. @default 'neutral' */
  tone?: ControlTone;
  /** Hide the trailing chevron icon. @default false */
  hideChevron?: boolean;
}

function CollapsibleTrigger({
  className,
  size = 'base',
  tone = 'neutral',
  hideChevron = false,
  children,
  ...props
}: CollapsibleTriggerProps) {
  return (
    <CollapsiblePrimitive.Trigger
      {...props}
      data-slot="collapsible-trigger"
      data-emphasis="low"
      data-size={size}
      data-tone={tone}
      className={cx(control({ emphasis: 'low', size, tone }), styles.trigger, className)}
    >
      {children}
      {!hideChevron && <Icon source={ChevronDownIcon} className={styles.chevron} />}
    </CollapsiblePrimitive.Trigger>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

function CollapsiblePanel({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={cx(styles.panel, className)}
      {...props}
    />
  );
}

export const Collapsible = {
  Root: CollapsibleRoot,
  Trigger: CollapsibleTrigger,
  Panel: CollapsiblePanel,
};
