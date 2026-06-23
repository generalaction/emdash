import type { Meta, StoryObj } from '@storybook/react-vite';
import { SURFACE_LEVELS, SURFACE_ROLES, SURFACE_STATUSES } from '@theme/core/contract/roles';
import type { SurfaceScopeName, SurfaceStatusName } from '@theme/core/contract/roles';
import { AlertCircleIcon, AlertTriangleIcon, InfoIcon } from 'lucide-react';
import React, { useState } from 'react';
import { Button } from '../primitives/button';
import { Callout } from '../primitives/callout';
import { Input } from '../primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select';
import { Surface } from '../primitives/surface';
import { ThemeProvider } from '../primitives/theme-provider';
import { Toggle } from '../primitives/toggle';
import * as s from '../story-layout.css';

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
    <div className={`${s.flex} ${s.flexCol} ${s.gap15}`}>
      <p className={`${s.fontMono} ${s.text10px} ${s.fontMedium} ${s.textForeground}`}>{label}</p>
      <div
        className={`${s.h10} ${s.wFull} ${s.rounded} ${s.border} ${s.borderBorder}`}
        style={{ background: `var(--surface-${level})` }}
        title={`--surface-${level}`}
      />
      <div
        className={`${s.h6} ${s.wFull} ${s.rounded}`}
        style={{ background: `var(--surface-${level}-hover)` }}
        title={`--surface-${level}-hover`}
      />
      <div
        className={`${s.h6} ${s.wFull} ${s.rounded}`}
        style={{
          background: `var(--surface-${level}-selected)`,
          boxShadow: isEmphasis ? 'inset 0 0 0 1px var(--border-primary)' : undefined,
        }}
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
      className={`bg-surface ${s.flex} ${s.flexCol} ${s.gap3} ${s.roundedLg} ${s.border} ${s.borderBorder} ${s.p4}`}
    >
      <p className={`${s.fontMono} ${s.textXs} ${s.textForegroundMuted}`}>.surface-{level}</p>
      <Input placeholder="Search…" />
      <div className={`${s.flex} ${s.gap2}`}>
        <Button variant="ghost" size="base">
          Ghost
        </Button>
        <Button variant="primary" size="base">
          Primary
        </Button>
      </div>
      <Select>
        <SelectTrigger className={s.wFull}>
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
    <Surface
      level={level}
      className={`${s.flex} ${s.flexCol} ${s.gap0} ${s.roundedLg} ${s.border} ${s.borderBorder}`}
    >
      <div
        className={`bg-surface ${s.flex} ${s.itemsCenter} ${s.gap1} ${s.borderB} ${s.borderBorder} ${s.px1} ${s.pt1}`}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-active={active === tab.id ? 'true' : undefined}
            onClick={() => setActive(tab.id)}
            className={s.storyTabButton}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Surface emphasis className={`bg-surface ${s.roundedBLg} ${s.p4}`}>
        <p className={`${s.textSm} ${s.textForegroundMuted}`}>
          Content for <strong className={s.textForeground}>{active}</strong> tab on{' '}
          <code className={`${s.fontMono} ${s.textXs}`}>.surface-{level}</code>
        </p>
      </Surface>
    </Surface>
  );
}

// ── Button row on a surface ───────────────────────────────────────────────────

function SurfaceButtons({ level }: { level: SurfaceScopeName }) {
  return (
    <Surface
      level={level}
      className={`${s.flex} ${s.flexCol} ${s.gap2} ${s.roundedLg} ${s.border} ${s.borderBorder} ${s.p4}`}
    >
      <p className={`${s.fontMono} ${s.textXs} ${s.textForegroundMuted}`}>.surface-{level}</p>
      <div className={`${s.flex} ${s.flexWrap} ${s.gap2}`}>
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
    <div className={`${s.spaceY4} ${s.p6}`}>
      <p className={`${s.textSm} ${s.textForegroundMuted}`}>
        Swatches: base → hover → selected for each elevation.
      </p>
      <div className={`${s.grid} ${s.cols5} ${s.gap4}`}>
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
    <div className={`${s.grid} ${s.cols3} ${s.gap4} ${s.p6}`}>
      {(['sunken', 'base', 'elevated'] as const).map((level) => (
        <Surface
          key={level}
          level={level}
          className={`bg-surface ${s.flex} ${s.flexCol} ${s.gap3} ${s.roundedXl} ${s.p4}`}
        >
          <p className={`${s.fontMono} ${s.textXs} ${s.textForegroundMuted}`}>.surface-{level}</p>
          <Surface emphasis className={`bg-surface ${s.roundedLg} ${s.p3}`}>
            <p className={`${s.textXs} ${s.textForegroundMuted}`}>.surface-emphasis (card)</p>
            <p className={`${s.mt1} ${s.textSm} ${s.textForeground}`}>
              Card content adapts automatically.
            </p>
          </Surface>
        </Surface>
      ))}
    </div>
  ),
};

/** Components (Input, Button, Select) on every surface level. */
export const ComponentsOnAllSurfaces: Story = {
  render: () => (
    <div className={`${s.grid} ${s.cols2} ${s.gap4} ${s.p6} ${s.lgCols3}`}>
      {SURFACE_LEVELS.map((level) => (
        <SurfaceCard key={level} level={level} />
      ))}
    </div>
  ),
};

/** Tab strips demonstrating hover and selected states on each surface. */
export const Tabs: Story = {
  render: () => (
    <div className={`${s.grid} ${s.cols1} ${s.gap4} ${s.p6} ${s.lgCols2}`}>
      {SURFACE_LEVELS.map((level) => (
        <SurfaceTabs key={level} level={level} />
      ))}
    </div>
  ),
};

/** Buttons demonstrating hover, selected, and destructive across every surface. */
export const Buttons: Story = {
  render: () => (
    <div className={`${s.grid} ${s.cols1} ${s.gap4} ${s.p6} ${s.lgCols2}`}>
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
    <div className={`${s.flex} ${s.flexCol} ${s.gap3}`}>
      <Callout status={status} icon={STATUS_ICON[status]}>
        <strong>{STATUS_LABEL[status]}:</strong> {STATUS_MESSAGE[status]}
      </Callout>
      <Surface
        status={status}
        className={`bg-surface ${s.flex} ${s.itemsCenter} ${s.gap2} ${s.roundedLg} ${s.border} ${s.p3}`}
        style={{ borderColor: `var(--surface-${status}-border)` }}
      >
        <span
          className={`${s.flex1} ${s.textSm}`}
          style={{ color: `var(--surface-${status}-foreground)` }}
        >
          Controls inside a status surface
        </span>
        <Toggle pressed={pressed} onPressedChange={setPressed} className={s.shrink0}>
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
    <div className={`${s.grid} ${s.cols1} ${s.gap6} ${s.p6}`}>
      <div>
        <p className={`${s.mb1} ${s.textSm} ${s.fontSemibold} ${s.textForeground}`}>
          Status surfaces — tinted rooms using the cascade
        </p>
        <p className={`${s.textXs} ${s.textForegroundMuted}`}>
          Each status box rebinds <code className={s.fontMono}>--surface-hover</code> and{' '}
          <code className={s.fontMono}>--surface-selected</code> so any ghost Button / Toggle inside
          already hovers/selects with the correct tint.
        </p>
      </div>
      {SURFACE_STATUSES.map((status) => (
        <StatusRoom key={status} status={status} />
      ))}
      <div>
        <p className={`${s.mb3} ${s.textSm} ${s.fontMedium} ${s.textForegroundMuted}`}>
          Swatches — base / hover / selected per status
        </p>
        <div className={`${s.grid} ${s.cols3} ${s.gap4}`}>
          {SURFACE_STATUSES.map((status) => (
            <div key={status} className={`${s.flex} ${s.flexCol} ${s.gap15}`}>
              <p className={`${s.fontMono} ${s.text10px} ${s.fontMedium} ${s.textForeground}`}>
                {status}
              </p>
              <div
                className={`${s.h10} ${s.wFull} ${s.rounded} ${s.border}`}
                style={{
                  background: `var(--surface-${status})`,
                  borderColor: `var(--surface-${status}-border)`,
                }}
                title={`--surface-${status}`}
              />
              <div
                className={`${s.h6} ${s.wFull} ${s.rounded}`}
                style={{ background: `var(--surface-${status}-hover)` }}
                title={`--surface-${status}-hover`}
              />
              <div
                className={`${s.h6} ${s.wFull} ${s.rounded}`}
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
    <div className={`${s.spaceY6} ${s.bgBackground} ${s.p6}`}>
      <div>
        <p className={`${s.textSm} ${s.fontSemibold} ${s.textForeground}`}>
          Paper — primary content / tab background
        </p>
        <p className={`${s.mt1} ${s.maxWProse} ${s.textXs} ${s.textForegroundMuted}`}>
          White-ish in light mode (matches <code className={s.fontMono}>elevated</code>) and flat
          with <code className={s.fontMono}>base</code> in dark mode. Use it for the surface tabbed
          content sits on. Cards/tabs on paper use <code className={s.fontMono}>base-emphasis</code>
          .
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '12rem 1fr', gap: '1.5rem' }}>
        <div className={`${s.flex} ${s.flexCol} ${s.gap4}`}>
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
    <div className={`${s.flex} ${s.minHScreen} ${s.divideX} ${s.divideBorder}`}>
      <ThemeProvider theme="light" className={s.flex1}>
        <PaperRoom />
      </ThemeProvider>
      <ThemeProvider theme="dark" className={s.flex1}>
        <PaperRoom />
      </ThemeProvider>
    </div>
  ),
};

/** Light and dark modes side-by-side. */
export const BothModes: Story = {
  render: () => (
    <div className={`${s.flex} ${s.minHScreen} ${s.divideX} ${s.divideBorder}`}>
      <ThemeProvider
        defaultTheme="light"
        className={`${s.flex1} ${s.spaceY6} ${s.bgBackground} ${s.p6}`}
      >
        <p className={`${s.textSm} ${s.fontMedium} ${s.textForeground}`}>Light mode</p>
        <div className={`${s.grid} ${s.cols3} ${s.gap3}`}>
          {SURFACE_LEVELS.map((level) => (
            <ElevationSwatch key={level} level={level} label={level} />
          ))}
        </div>
        <div className={`${s.grid} ${s.cols2} ${s.gap3}`}>
          {SURFACE_LEVELS.map((level) => (
            <SurfaceCard key={level} level={level} />
          ))}
        </div>
      </ThemeProvider>
      <ThemeProvider
        defaultTheme="dark"
        className={`${s.flex1} ${s.spaceY6} ${s.bgBackground} ${s.p6}`}
      >
        <p className={`${s.textSm} ${s.fontMedium} ${s.textForeground}`}>Dark mode</p>
        <div className={`${s.grid} ${s.cols3} ${s.gap3}`}>
          {SURFACE_LEVELS.map((level) => (
            <ElevationSwatch key={level} level={level} label={level} />
          ))}
        </div>
        <div className={`${s.grid} ${s.cols2} ${s.gap3}`}>
          {SURFACE_LEVELS.map((level) => (
            <SurfaceCard key={level} level={level} />
          ))}
        </div>
      </ThemeProvider>
    </div>
  ),
};
