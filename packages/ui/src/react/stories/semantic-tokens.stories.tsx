import type { Meta, StoryObj } from '@storybook/react-vite';
import { SEMANTIC_VARS } from '@theme/core/contract/semantic-template';
import React, { useEffect, useRef } from 'react';
import { ThemeProvider } from '../primitives/theme-provider';
import * as s from '../story-layout.css';

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
  { title: 'Primary button', match: (v) => v.startsWith('--primary-button') },
  { title: 'Selection', match: (v) => v.startsWith('--selection') },
  { title: 'Status', match: (v) => v.startsWith('--status') },
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

function categorize(vars: readonly string[]): Array<{ title: string; tokens: string[] }> {
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
      <div
        ref={ref}
        className={`${s.flex} ${s.h8} ${s.w16} ${s.shrink0} ${s.itemsCenter} ${s.justifyCenter} ${s.rounded} ${s.border} ${s.borderBorder} ${s.bgBackground} ${s.textSm} ${s.fontSemibold}`}
        style={{ color: `var(${varName})` }}
      >
        Aa
      </div>
    ) : kind === 'border' ? (
      <div
        ref={ref}
        className={`${s.h8} ${s.w16} ${s.shrink0} ${s.rounded} ${s.bgBackground}`}
        style={{ border: `2px solid var(${varName})` }}
      />
    ) : (
      <div
        ref={ref}
        className={`${s.h8} ${s.w16} ${s.shrink0} ${s.rounded} ${s.border} ${s.borderBorder}`}
        style={{ background: `var(${varName})` }}
      />
    );

  return (
    <div className={`${s.flex} ${s.itemsCenter} ${s.gap3} ${s.py15}`}>
      {preview}
      <div className={`${s.flex} ${s.minW0} ${s.flexCol} ${s.gapHalf}`}>
        <span className={`${s.fontMono} ${s.textXs} ${s.textForeground}`}>{varName}</span>
        <span
          ref={resolvedRef}
          className={`${s.fontMono} ${s.text10px} ${s.textForegroundPassive}`}
        />
      </div>
    </div>
  );
}

// ── Section block ─────────────────────────────────────────────────────────────

function SectionBlock({ title, tokens }: { title: string; tokens: string[] }) {
  return (
    <div>
      <h3
        className={`${s.mb2} ${s.borderB} ${s.borderBorder} ${s.pb1} ${s.text11px} ${s.fontSemibold} ${s.trackingWider} ${s.textForegroundMuted} ${s.uppercase}`}
      >
        {title}
      </h3>
      <div className={`${s.grid} ${s.cols1} ${s.gap0}`}>
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
    <div className={`${s.flex} ${s.flexCol} ${s.gap8} ${s.bgBackground} ${s.p6}`}>
      <div>
        <h2 className={`${s.textSm} ${s.fontSemibold} ${s.textForeground}`}>
          Semantic Color Tokens
        </h2>
        <p className={`${s.mt1} ${s.textXs} ${s.textForegroundMuted}`}>
          Every semantic CSS custom property defined in{' '}
          <code className={`${s.rounded} ${s.bgBackground2} ${s.px1} ${s.fontMono} ${s.text11px}`}>
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
    <div className={`${s.flex} ${s.minHScreen}`}>
      <ThemeProvider defaultTheme="light" className={`${s.flex1} ${s.overflowAuto}`}>
        <div
          className={`${s.borderB} ${s.borderBorder} ${s.bgBackground} ${s.px6} ${s.py3} ${s.textSm} ${s.fontMedium} ${s.textForeground}`}
        >
          Light
        </div>
        <SemanticTokenGrid />
      </ThemeProvider>
      <ThemeProvider defaultTheme="dark" className={`${s.flex1} ${s.overflowAuto}`}>
        <div
          className={`${s.borderB} ${s.borderBorder} ${s.bgBackground} ${s.px6} ${s.py3} ${s.textSm} ${s.fontMedium} ${s.textForeground}`}
        >
          Dark
        </div>
        <SemanticTokenGrid />
      </ThemeProvider>
    </div>
  ),
};
