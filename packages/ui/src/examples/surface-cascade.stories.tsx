import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { AlertCircleIcon, AlertTriangleIcon, InfoIcon } from 'lucide-react';
import { Button } from '../primitives/button';
import { Callout } from '../primitives/callout';
import { Input } from '../primitives/input';
import { Surface } from '../primitives/surface';
import { ThemeProvider } from '../primitives/theme-provider';
import { Toggle } from '../primitives/toggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select';
import { SURFACE_LEVELS, SURFACE_ROLES, SURFACE_STATUSES } from '../theme/contract/roles';
import type { SurfaceScopeName, SurfaceStatusName } from '../theme/contract/roles';

const meta: Meta = {
  title: 'Examples/Surface Cascade',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj;

// ── Swatch helpers ────────────────────────────────────────────────────────────

/** Base / hover / selected swatches for a given direct-elevation CSS var prefix. */
function ElevationSwatch({ level, label }: { level: string; label: string }) {
  const isEmphasis = level.includes('emphasis');
  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-mono text-[10px] font-medium text-foreground">{label}</p>
      <div
        className="h-10 w-full rounded border border-border"
        style={{ background: `var(--surface-${level})` }}
        title={`--surface-${level}`}
      />
      <div
        className="h-6 w-full rounded"
        style={{ background: `var(--surface-${level}-hover)` }}
        title={`--surface-${level}-hover`}
      />
      <div
        className={`h-6 w-full rounded ${isEmphasis ? 'ring-1 ring-border-primary ring-inset' : ''}`}
        style={{ background: `var(--surface-${level}-selected)` }}
        title={`--surface-${level}-selected`}
      />
    </div>
  );
}

// ── Components rendered on a surface card ─────────────────────────────────────

function SurfaceCard({ level }: { level: SurfaceScopeName }) {
  return (
    <Surface
      level={level}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <p className="font-mono text-xs text-foreground-muted">.surface-{level}</p>
      <Input placeholder="Search…" />
      <div className="flex gap-2">
        <Button variant="ghost" size="base">
          Ghost
        </Button>
        <Button variant="primary" size="base">
          Primary
        </Button>
      </div>
      <Select>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Pick one…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
        </SelectContent>
      </Select>
    </Surface>
  );
}

// ── Tabs helper ───────────────────────────────────────────────────────────────

function SurfaceTabs({ level }: { level: SurfaceScopeName }) {
  const [active, setActive] = useState('first');
  const tabs = [
    { id: 'first', label: 'First' },
    { id: 'second', label: 'Second' },
    { id: 'third', label: 'Third' },
  ];
  return (
    <Surface level={level} className="flex flex-col gap-0 rounded-lg border border-border">
      <div className="flex items-center gap-1 border-b border-border bg-surface px-1 pt-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-active={active === tab.id ? 'true' : undefined}
            onClick={() => setActive(tab.id)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2.5 text-sm text-foreground-muted transition-all hover:bg-surface-hover hover:text-foreground data-[active=true]:bg-surface-selected data-[active=true]:text-foreground"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Surface emphasis className="rounded-b-lg bg-surface p-4">
        <p className="text-sm text-foreground-muted">
          Content for <strong className="text-foreground">{active}</strong> tab on{' '}
          <code className="font-mono text-xs">.surface-{level}</code>
        </p>
      </Surface>
    </Surface>
  );
}

// ── Button row on a surface ───────────────────────────────────────────────────

function SurfaceButtons({ level }: { level: SurfaceScopeName }) {
  return (
    <Surface level={level} className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <p className="font-mono text-xs text-foreground-muted">.surface-{level}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost">Ghost</Button>
        <Button variant="ghost" tone="destructive">
          Destructive
        </Button>
        <Button variant="primary">Primary</Button>
        <Button variant="primary" tone="destructive">
          Primary Destructive
        </Button>
      </div>
    </Surface>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

/** One swatch per elevation step (base / hover / selected). */
export const Ladder: Story = {
  render: () => (
    <div className="space-y-4 p-6">
      <p className="text-sm text-foreground-muted">
        Swatches: base → hover → selected for each elevation.
      </p>
      <div className="grid grid-cols-5 gap-4">
        {SURFACE_LEVELS.map((level) => (
          <ElevationSwatch key={level} level={level} label={level} />
        ))}
      </div>
    </div>
  ),
};

/** Cascade proof: surface-emphasis card on each surface. */
export const Cascade: Story = {
  render: () => (
    <div className="grid grid-cols-3 gap-4 p-6">
      {(['sunken', 'base', 'elevated'] as const).map((level) => (
        <Surface
          key={level}
          level={level}
          className="flex flex-col gap-3 rounded-xl bg-surface p-4"
        >
          <p className="font-mono text-xs text-foreground-muted">.surface-{level}</p>
          <Surface emphasis className="rounded-lg bg-surface p-3">
            <p className="text-xs text-foreground-muted">.surface-emphasis (card)</p>
            <p className="mt-1 text-sm text-foreground">Card content adapts automatically.</p>
          </Surface>
        </Surface>
      ))}
    </div>
  ),
};

/** Components (Input, Button, Select) on every surface level. */
export const ComponentsOnAllSurfaces: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4 p-6 lg:grid-cols-3">
      {SURFACE_LEVELS.map((level) => (
        <SurfaceCard key={level} level={level} />
      ))}
    </div>
  ),
};

/** Tab strips demonstrating hover and selected states on each surface. */
export const Tabs: Story = {
  render: () => (
    <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
      {SURFACE_LEVELS.map((level) => (
        <SurfaceTabs key={level} level={level} />
      ))}
    </div>
  ),
};

/** Buttons demonstrating hover, selected, and destructive across every surface. */
export const Buttons: Story = {
  render: () => (
    <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-2">
      {SURFACE_LEVELS.map((level) => (
        <SurfaceButtons key={level} level={level} />
      ))}
    </div>
  ),
};

// ── Status surfaces ────────────────────────────────────────────────────────────

const STATUS_ICON: Record<SurfaceStatusName, React.ReactNode> = {
  info: <InfoIcon />,
  warning: <AlertTriangleIcon />,
  destructive: <AlertCircleIcon />,
};

const STATUS_LABEL: Record<SurfaceStatusName, string> = {
  info: 'Info',
  warning: 'Warning',
  destructive: 'Destructive',
};

const STATUS_MESSAGE: Record<SurfaceStatusName, string> = {
  info: 'This is an informational message. Ghost controls inside adapt to the tinted surface.',
  warning: 'Something needs your attention. Controls inherit the tinted hover/selected states.',
  destructive: 'This action cannot be undone. All controls respond to the destructive surface.',
};

function StatusRoom({ status }: { status: SurfaceStatusName }) {
  const [pressed, setPressed] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Callout status={status} icon={STATUS_ICON[status]}>
        <strong>{STATUS_LABEL[status]}:</strong> {STATUS_MESSAGE[status]}
      </Callout>
      <Surface
        status={status}
        className="flex items-center gap-2 rounded-lg border bg-surface p-3"
        style={{ borderColor: `var(--surface-${status}-border)` }}
      >
        <span className="flex-1 text-sm" style={{ color: `var(--surface-${status}-foreground)` }}>
          Controls inside a status surface
        </span>
        <Toggle pressed={pressed} onPressedChange={setPressed} className="shrink-0">
          {pressed ? 'Active' : 'Toggle'}
        </Toggle>
        <Button variant="ghost" tone="neutral">
          Action
        </Button>
        <Button variant="ghost" tone="destructive">
          Delete
        </Button>
      </Surface>
    </div>
  );
}

/**
 * Status surface variants (destructive / warning / info). Each is a tinted
 * "room" — ghost controls inside automatically pick up the tinted hover/selected
 * states from the cascade without any per-component override.
 */
export const StatusSurfaces: Story = {
  render: () => (
    <div className="grid grid-cols-1 gap-6 p-6">
      <div>
        <p className="mb-1 text-sm font-semibold text-foreground">
          Status surfaces — tinted rooms using the cascade
        </p>
        <p className="text-xs text-foreground-muted">
          Each status box rebinds <code className="font-mono">--surface-hover</code> and{' '}
          <code className="font-mono">--surface-selected</code> so any ghost Button / Toggle
          inside already hovers/selects with the correct tint.
        </p>
      </div>
      {SURFACE_STATUSES.map((status) => (
        <StatusRoom key={status} status={status} />
      ))}
      <div>
        <p className="mb-3 text-sm font-medium text-foreground-muted">
          Swatches — base / hover / selected per status
        </p>
        <div className="grid grid-cols-3 gap-4">
          {SURFACE_STATUSES.map((status) => (
            <div key={status} className="flex flex-col gap-1.5">
              <p className="font-mono text-[10px] font-medium text-foreground">{status}</p>
              <div
                className="h-10 w-full rounded border"
                style={{
                  background: `var(--surface-${status})`,
                  borderColor: `var(--surface-${status}-border)`,
                }}
                title={`--surface-${status}`}
              />
              <div
                className="h-6 w-full rounded"
                style={{ background: `var(--surface-${status}-hover)` }}
                title={`--surface-${status}-hover`}
              />
              <div
                className="h-6 w-full rounded"
                style={{ background: `var(--surface-${status}-selected)` }}
                title={`--surface-${status}-selected`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  ),
};

// ── Paper role ─────────────────────────────────────────────────────────────────

/** Renders the paper role's swatch + a tab strip that uses paper as its canvas. */
function PaperRoom() {
  return (
    <div className="space-y-6 bg-background p-6">
      <div>
        <p className="text-sm font-semibold text-foreground">
          Paper — primary content / tab background
        </p>
        <p className="mt-1 max-w-prose text-xs text-foreground-muted">
          White-ish in light mode (matches <code className="font-mono">elevated</code>) and flat
          with <code className="font-mono">base</code> in dark mode. Use it for the surface tabbed
          content sits on. Cards/tabs on paper use <code className="font-mono">base-emphasis</code>.
        </p>
      </div>
      <div className="grid grid-cols-[12rem_1fr] gap-6">
        <div className="flex flex-col gap-4">
          {SURFACE_ROLES.map((role) => (
            <ElevationSwatch key={role} level={role} label={role} />
          ))}
        </div>
        <SurfaceTabs level="paper" />
      </div>
    </div>
  );
}

/**
 * The `paper` surface role. Because it is white in light but base-gray in dark,
 * it is best understood side-by-side — the tab content reads as a white sheet in
 * light mode and disappears into the base canvas in dark mode.
 */
export const Paper: Story = {
  render: () => (
    <div className="flex min-h-screen divide-x divide-border">
      <ThemeProvider theme="light" className="flex-1">
        <PaperRoom />
      </ThemeProvider>
      <ThemeProvider theme="dark" className="flex-1">
        <PaperRoom />
      </ThemeProvider>
    </div>
  ),
};

/** Light and dark modes side-by-side. */
export const BothModes: Story = {
  render: () => (
    <div className="flex min-h-screen divide-x divide-border">
      <ThemeProvider defaultTheme="light" className="flex-1 space-y-6 bg-background p-6">
        <p className="text-sm font-medium text-foreground">Light mode</p>
        <div className="grid grid-cols-3 gap-3">
          {SURFACE_LEVELS.map((level) => (
            <ElevationSwatch key={level} level={level} label={level} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {SURFACE_LEVELS.map((level) => (
            <SurfaceCard key={level} level={level} />
          ))}
        </div>
      </ThemeProvider>
      <ThemeProvider defaultTheme="dark" className="flex-1 space-y-6 bg-background p-6">
        <p className="text-sm font-medium text-foreground">Dark mode</p>
        <div className="grid grid-cols-3 gap-3">
          {SURFACE_LEVELS.map((level) => (
            <ElevationSwatch key={level} level={level} label={level} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {SURFACE_LEVELS.map((level) => (
            <SurfaceCard key={level} level={level} />
          ))}
        </div>
      </ThemeProvider>
    </div>
  ),
};
