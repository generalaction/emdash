import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { controlVariants, type ControlVariantProps } from '@styles/recipes/control';
import * as React from 'react';
import { cx } from '@styles/utilities/cx';
import * as styles from './tabs.css';

// ── Root ──────────────────────────────────────────────────────────────────────

const Tabs = TabsPrimitive.Root;

// ── List ──────────────────────────────────────────────────────────────────────

/**
 * The tab strip container. Uses bg-surface so it picks up the current surface
 * scope; each tab's hover/selected resolves from the same scope.
 */
function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cx(styles.tabsList, className)}
      {...props}
    />
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export interface TabsTabProps extends TabsPrimitive.Tab.Props {
  size?: ControlVariantProps['size'];
  tone?: ControlVariantProps['tone'];
}

/**
 * A single tab. base-ui sets data-selected / aria-selected on the active tab,
 * which the controlVariants recipe maps to bg-surface-selected automatically.
 */
const TabsTab = React.forwardRef<HTMLButtonElement, TabsTabProps>(function TabsTab(
  { className, size = 'sm', tone = 'neutral', ...props },
  ref
) {
  return (
    <TabsPrimitive.Tab
      ref={ref}
      data-slot="tabs-tab"
      className={cx(controlVariants({ variant: 'ghost', tone, size }), className)}
      {...props}
    />
  );
});

// ── Panel ─────────────────────────────────────────────────────────────────────

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cx(styles.tabsPanel, className)}
      {...props}
    />
  );
}

// ── Indicator (optional animated underline / pill) ────────────────────────────

function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cx(styles.tabsIndicator, className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTab, TabsPanel, TabsIndicator };
