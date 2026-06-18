import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect, useRef } from 'react';
import { SEMANTIC_VARS } from '../theme/contract/contract.generated';

// ── Sections ──────────────────────────────────────────────────────────────────
//
// Tokens are grouped by prefix. The match functions run in order; the first
// match wins. Any token not matched ends up in the final "Other" bucket.

type Section = {
  title: string;
  match: (v: string) => boolean;
};

const SECTIONS: Section[] = [
  {
    title: 'Base backgrounds',
    match: (v) => /^--background(-[0-9])?$/.test(v),
  },
  {
    title: 'Secondary / tertiary / quaternary backgrounds',
    match: (v) =>
      v.startsWith('--background-secondary') ||
      v.startsWith('--background-tertiary') ||
      v.startsWith('--background-quaternary') ||
      v === '--background-neutral',
  },
  {
    title: 'Foregrounds',
    match: (v) =>
      v.startsWith('--foreground') &&
      !v.startsWith('--foreground-diff') &&
      !v.startsWith('--foreground-success') &&
      !v.startsWith('--foreground-error') &&
      !v.startsWith('--foreground-warning') &&
      !v.startsWith('--foreground-info') &&
      !v.startsWith('--foreground-destructive') &&
      v !== '--foreground-conflict' &&
      v !== '--foreground-merged',
  },
  {
    title: 'Borders',
    match: (v) =>
      v.startsWith('--border') &&
      !v.startsWith('--border-success') &&
      !v.startsWith('--border-error') &&
      !v.startsWith('--border-warning') &&
      !v.startsWith('--border-info'),
  },
  {
    title: 'Primary button',
    match: (v) => v.startsWith('--primary-button'),
  },
  {
    title: 'Selection',
    match: (v) => v.startsWith('--selection'),
  },
  {
    title: 'Status',
    match: (v) => v.startsWith('--status'),
  },
  {
    title: 'Diff / VCS',
    match: (v) =>
      v.startsWith('--foreground-diff') ||
      v === '--foreground-conflict' ||
      v === '--foreground-merged',
  },
  {
    title: 'Success',
    match: (v) =>
      v.startsWith('--foreground-success') ||
      v.startsWith('--background-success') ||
      v.startsWith('--border-success'),
  },
  {
    title: 'Error / Destructive',
    match: (v) =>
      v.startsWith('--foreground-error') ||
      v.startsWith('--background-error') ||
      v.startsWith('--border-error') ||
      v.startsWith('--foreground-destructive') ||
      v.startsWith('--background-destructive') ||
      v.startsWith('--border-destructive'),
  },
  {
    title: 'Warning',
    match: (v) =>
      v.startsWith('--foreground-warning') ||
      v.startsWith('--background-warning') ||
      v.startsWith('--border-warning'),
  },
  {
    title: 'Info',
    match: (v) =>
      v.startsWith('--foreground-info') ||
      v.startsWith('--background-info') ||
      v.startsWith('--border-info'),
  },
];

function categorize(
  vars: readonly string[],
): Array<{ title: string; tokens: string[] }> {
  const assigned = new Set<string>();
  const groups = SECTIONS.map(({ title, match }) => ({
    title,
    tokens: vars.filter((v) => {
      if (assigned.has(v)) return false;
      if (match(v)) {
        assigned.add(v);
        return true;
      }
      return false;
    }),
  }));

  const remaining = vars.filter((v) => !assigned.has(v));
  if (remaining.length > 0) {
    groups.push({ title: 'Other', tokens: remaining });
  }

  return groups.filter((g) => g.tokens.length > 0);
}

// ── Token kind detection ──────────────────────────────────────────────────────

type TokenKind = 'foreground' | 'background' | 'border' | 'mixed';

function detectKind(varName: string): TokenKind {
  if (varName.startsWith('--foreground') || varName.startsWith('--status')) {
    return 'foreground';
  }
  if (
    varName.startsWith('--background') ||
    varName === '--selection' ||
    varName.startsWith('--primary-button-background')
  ) {
    return 'background';
  }
  if (varName.startsWith('--border')) {
    return 'border';
  }
  return 'background';
}

// ── Token row ─────────────────────────────────────────────────────────────────

function TokenRow({ varName }: { varName: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const kind = detectKind(varName);

  // Read the resolved value once mounted (updates on each render → theme switches)
  const resolvedRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!ref.current || !resolvedRef.current) return;
    const computed = getComputedStyle(ref.current);
    if (kind === 'border') {
      resolvedRef.current.textContent = computed.borderColor;
    } else if (kind === 'foreground') {
      resolvedRef.current.textContent = computed.color;
    } else {
      resolvedRef.current.textContent = computed.backgroundColor;
    }
  });

  const preview =
    kind === 'foreground' ? (
      // Text preview: colored text on neutral background
      <div
        ref={ref}
        className="flex h-8 w-16 shrink-0 items-center justify-center rounded border border-border bg-background text-sm font-semibold"
        style={{ color: `var(${varName})` }}
      >
        Aa
      </div>
    ) : kind === 'border' ? (
      // Border preview: box drawn in that border color
      <div
        ref={ref}
        className="h-8 w-16 shrink-0 rounded bg-background"
        style={{ border: `2px solid var(${varName})` }}
      />
    ) : (
      // Background / fill preview
      <div
        ref={ref}
        className="h-8 w-16 shrink-0 rounded border border-border"
        style={{ background: `var(${varName})` }}
      />
    );

  return (
    <div className="flex items-center gap-3 py-1.5">
      {preview}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-xs text-foreground">{varName}</span>
        <span
          ref={resolvedRef}
          className="font-mono text-[10px] text-foreground-passive"
        />
      </div>
    </div>
  );
}

// ── Section block ─────────────────────────────────────────────────────────────

function SectionBlock({ title, tokens }: { title: string; tokens: string[] }) {
  return (
    <div>
      <h3 className="mb-2 border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-3">
        {tokens.map((v) => (
          <TokenRow key={v} varName={v} />
        ))}
      </div>
    </div>
  );
}

// ── Full token page ───────────────────────────────────────────────────────────

function SemanticTokenGrid() {
  const groups = categorize(SEMANTIC_VARS);
  return (
    <div className="flex flex-col gap-8 bg-background p-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Semantic Color Tokens</h2>
        <p className="mt-1 text-xs text-foreground-muted">
          Every semantic CSS custom property defined in{' '}
          <code className="rounded bg-background-2 px-1 font-mono text-[11px]">
            semantic-template.ts
          </code>
          . Foreground tokens show colored text; border tokens show a colored outline; all others
          show a filled swatch. Computed values update when the light/dark toolbar changes.
        </p>
      </div>

      {groups.map((g) => (
        <SectionBlock key={g.title} title={g.title} tokens={g.tokens} />
      ))}
    </div>
  );
}

// ── Storybook ─────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Theme/Semantic Tokens',
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj;

/** All semantic tokens grouped by category — responds to the Light / Dark toolbar. */
export const SemanticTokens: Story = {
  render: () => <SemanticTokenGrid />,
};

/** Light and dark semantic tokens side-by-side. */
export const BothModes: Story = {
  render: () => (
    <div className="flex min-h-screen">
      <div className="emlight flex-1 overflow-auto">
        <div className="border-b border-border bg-background px-6 py-3 text-sm font-medium text-foreground">
          Light
        </div>
        <SemanticTokenGrid />
      </div>
      <div className="emdark flex-1 overflow-auto">
        <div className="border-b border-border bg-background px-6 py-3 text-sm font-medium text-foreground">
          Dark
        </div>
        <SemanticTokenGrid />
      </div>
    </div>
  ),
};
