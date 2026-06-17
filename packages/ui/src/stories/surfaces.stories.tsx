import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Button } from '../primitives/button';
import { Input } from '../primitives/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select';

const FAMILIES = ['sunken', 'base', 'raised', 'overlay', 'floating'] as const;
type SurfaceFamily = (typeof FAMILIES)[number];

const meta: Meta = {
  title: 'Theme/Surfaces',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj;

/** Swatch showing base, hover, and selected state for a single surface family. */
function SurfaceSwatch({ family }: { family: SurfaceFamily }) {
  return (
    <div className={`surface-${family} flex flex-col gap-1`}>
      <div className="bg-surface rounded px-3 py-2 text-sm font-medium text-foreground">
        .surface-{family}
      </div>
      <div className="bg-surface-hover rounded px-3 py-2 text-xs text-foreground-muted">hover</div>
      <div className="bg-surface-selected rounded px-3 py-2 text-xs text-foreground-muted">
        selected
      </div>
    </div>
  );
}

/** Card with a few components rendered on a given surface. */
function SurfaceCard({ family }: { family: SurfaceFamily }) {
  return (
    <div
      className={`surface-${family} bg-surface flex flex-col gap-3 rounded-lg border border-border p-4`}
    >
      <p className="font-mono text-xs text-foreground-muted">.surface-{family}</p>
      <Input placeholder="Search…" />
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick option" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Option A</SelectItem>
          <SelectItem value="b">Option B</SelectItem>
          <SelectItem value="c">Option C</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm">Confirm</Button>
        <Button size="sm" variant="outline">
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Shows base / hover / selected swatches for every surface family. */
export const Palette: Story = {
  render: () => (
    <div className="space-y-2 bg-background p-8">
      <p className="mb-4 text-xs text-foreground-muted">
        Each column is one surface family. Rows show base → hover → selected states (OKLab ΔL
        derivation).
      </p>
      <div className="grid grid-cols-5 gap-3">
        {FAMILIES.map((f) => (
          <SurfaceSwatch key={f} family={f} />
        ))}
      </div>
    </div>
  ),
};

/** Same UI components rendered on all four surface contexts side-by-side. */
export const ComponentsOnAllSurfaces: Story = {
  render: () => (
    <div className="bg-background p-8">
      <p className="mb-6 text-xs text-foreground-muted">
        Components are identical in every card — only the surface context class changes.
      </p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {FAMILIES.map((f) => (
          <SurfaceCard key={f} family={f} />
        ))}
      </div>
    </div>
  ),
};

/** Light and dark modes rendered next to each other without the toolbar. */
export const BothModes: Story = {
  render: () => (
    <div className="flex min-h-screen">
      <div className="emlight flex-1 space-y-6 bg-background p-8">
        <p className="text-sm font-medium text-foreground">Light mode</p>
        <div className="grid grid-cols-2 gap-3">
          {FAMILIES.map((f) => (
            <SurfaceCard key={f} family={f} />
          ))}
        </div>
      </div>
      <div className="emdark flex-1 space-y-6 bg-background p-8">
        <p className="text-sm font-medium text-foreground">Dark mode</p>
        <div className="grid grid-cols-2 gap-3">
          {FAMILIES.map((f) => (
            <SurfaceCard key={f} family={f} />
          ))}
        </div>
      </div>
    </div>
  ),
};
