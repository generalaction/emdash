import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { joinClassNames as cx } from '@styles/classnames';
import { control } from '@styles/recipes/control';
import * as React from 'react';
import type { ControlSize, ControlTone } from '../../../styles/recipes/control';
import * as styles from './tabs.css';

// ── Root ──────────────────────────────────────────────────────────────────────

/** `className` is applied to the rendered Tabs state root. */
function TabsRoot({ className, ...props }: TabsPrimitive.Root.Props) {
  return <TabsPrimitive.Root {...props} data-slot="tabs" className={className} />;
}

// ── List ──────────────────────────────────────────────────────────────────────

/** `className` is applied to the rendered tab-list root. */
function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      {...props}
      data-slot="tabs-list"
      className={cx(styles.tabsList, className)}
    />
  );
}

// ── Tab ───────────────────────────────────────────────────────────────────────

export interface TabsTabProps extends Omit<TabsPrimitive.Tab.Props, 'className'> {
  /**
   * Applies caller-owned classes to the rendered tab root. Use `sx()` for
   * finite static layout overrides.
   */
  className?: string;
  /** Shared four-step control size. @default 'xs' */
  size?: ControlSize;
  /** Semantic status intent. @default 'neutral' */
  tone?: ControlTone;
}

const TabsTab = React.forwardRef<HTMLButtonElement, TabsTabProps>(function TabsTab(
  { className, size = 'xs', tone = 'neutral', ...props },
  ref
) {
  return (
    <TabsPrimitive.Tab
      ref={ref}
      {...props}
      data-slot="tabs-tab"
      data-emphasis="minimal"
      data-size={size}
      data-tone={tone}
      className={cx(control({ emphasis: 'minimal', tone, size }), className)}
    />
  );
});

// ── Panel ─────────────────────────────────────────────────────────────────────

/** `className` is applied to the rendered panel root. */
function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      {...props}
      data-slot="tabs-panel"
      className={cx(styles.tabsPanel, className)}
    />
  );
}

export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanel,
};
