import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Surface } from '../primitives/surface';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select';
import { SURFACE_LEVELS } from '../theme/contract/roles';
import type { SurfaceLevelName } from '../theme/contract/roles';

const meta: Meta = {
  title: 'Theme/Surfaces',
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

function SurfaceCard({ level }: { level: SurfaceLevelName }) {
  return (
    <Surface
      level={level}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <p className="font-mono text-xs text-foreground-muted">.surface-{level}</p>
      <Input placeholder="Search…" />
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick option" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm">Confirm</Button>
        <Button size="sm" variant="outline">
          Cancel
        </Button>
      </div>
    </Surface>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────────

/**
 * Every elevation level (darkest → lightest) with base / hover / selected swatches.
 * Rows show that adjacent hover states are distinct from the next rung.
 */
export const Ladder: Story = {
  render: () => (
    <div className="flex flex-col gap-6 bg-background p-8">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Surface Ladder</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          Ordered darkest → lightest. Each column: base (tall) / hover / selected (short).
          Hover on a swatch for the CSS variable name.
        </p>
      </div>
      <div className="grid grid-cols-5 gap-4">
        {SURFACE_LEVELS.map((level) => (
          <ElevationSwatch key={level} level={level} label={level} />
        ))}
      </div>
      <div>
        <p className="text-xs text-foreground-passive">
          Adjacency check: hover(base) should be clearly distinct from base-emphasis.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <div
            className="h-8 w-24 rounded border border-border text-center text-[10px] leading-8 text-foreground-muted"
            style={{ background: 'var(--surface-base-hover)' }}
          >
            base hover
          </div>
          <span className="text-xs text-foreground-muted">vs</span>
          <div
            className="h-8 w-24 rounded border border-border text-center text-[10px] leading-8 text-foreground-muted"
            style={{ background: 'var(--surface-base-emphasis)' }}
          >
            base-emphasis
          </div>
        </div>
      </div>
    </div>
  ),
};

/**
 * The cascade proof — identical Card markup resolves to different colors depending
 * only on the nearest canvas scope, with no level hardcoded in the card itself.
 */
export const Cascade: Story = {
  render: () => (
    <div className="flex flex-col gap-8 bg-background p-8">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Cascade proof</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          The two cards below use identical markup: <code className="font-mono">{'<Surface emphasis>'}</code> + <code className="font-mono">bg-surface</code>.
          The background color resolves automatically from the nearest canvas scope.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Canvas 1: base */}
        <Surface level="base" className="rounded-xl border border-border bg-surface p-6">
          <p className="mb-4 font-mono text-xs text-foreground-muted">.surface-base (canvas)</p>
          <Surface emphasis className="rounded-lg border border-border bg-surface p-4">
            <p className="font-mono text-xs text-foreground-muted">.surface-emphasis → base-emphasis</p>
            <p className="mt-2 text-xs text-foreground">
              This card auto-resolved to <code className="font-mono">--surface-base-emphasis</code>.
            </p>
          </Surface>
        </Surface>

        {/* Canvas 2: elevated */}
        <Surface level="elevated" className="rounded-xl border border-border bg-surface p-6">
          <p className="mb-4 font-mono text-xs text-foreground-muted">.surface-elevated (canvas)</p>
          <Surface emphasis className="rounded-lg border border-border bg-surface p-4">
            <p className="font-mono text-xs text-foreground-muted">.surface-emphasis → elevated-emphasis</p>
            <p className="mt-2 text-xs text-foreground">
              Same markup resolves to <code className="font-mono">--surface-elevated-emphasis</code>.
            </p>
          </Surface>
        </Surface>
      </div>
    </div>
  ),
};

/** UI components rendered on each surface level. */
export const ComponentsOnAllSurfaces: Story = {
  render: () => (
    <div className="bg-background p-8">
      <p className="mb-6 text-xs text-foreground-muted">
        Components are identical in every card — only the surface level differs.
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {SURFACE_LEVELS.map((level) => (
          <SurfaceCard key={level} level={level} />
        ))}
      </div>
    </div>
  ),
};

/** Light and dark modes side-by-side for visual parity. */
export const BothModes: Story = {
  render: () => (
    <div className="flex min-h-screen">
      <div className="emlight flex-1 space-y-6 bg-background p-6">
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
      </div>
      <div className="emdark flex-1 space-y-6 bg-background p-6">
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
      </div>
    </div>
  ),
};
