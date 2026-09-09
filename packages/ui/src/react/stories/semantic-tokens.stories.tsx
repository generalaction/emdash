import { tokens, type TokenReference } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import type { CSSProperties } from 'react';
import * as s from '../story-layout.css';

type TokenLeaf = {
  path: string;
  reference: TokenReference;
};

function collectTokenLeaves(
  value: Readonly<Record<string, unknown>>,
  parentPath = 'tokens'
): TokenLeaf[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${parentPath}.${key}`;
    if (typeof child === 'string') {
      return [{ path, reference: child as TokenReference }];
    }
    return collectTokenLeaves(child as Readonly<Record<string, unknown>>, path);
  });
}

const TOKEN_GROUPS = Object.entries(tokens).map(([name, value]) => ({
  name,
  leaves: collectTokenLeaves(value, `tokens.${name}`),
}));

function tokenPreviewStyle(path: string, reference: TokenReference): CSSProperties | undefined {
  if (path.startsWith('tokens.foreground')) return { color: reference };
  if (path.startsWith('tokens.border')) return { borderColor: reference };
  if (
    path.startsWith('tokens.palette') ||
    path.startsWith('tokens.surface') ||
    path.startsWith('tokens.feedback') ||
    path.startsWith('tokens.selection')
  ) {
    return { background: reference };
  }
  return undefined;
}

function TokenRow({ path, reference }: TokenLeaf) {
  const previewStyle = tokenPreviewStyle(path, reference);

  return (
    <li
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space.step2,
        py: tokens.space.step1,
      })}
    >
      {previewStyle ? (
        <span
          aria-hidden
          className={cx(
            s.h8,
            s.w12,
            sx({
              flexShrink: 0,
              borderRadius: tokens.radius.sm,
              borderWidth: '1',
              borderStyle: 'solid',
              borderColor: tokens.border.default,
            })
          )}
          style={previewStyle}
        >
          {path.startsWith('tokens.foreground') ? 'Aa' : null}
        </span>
      ) : null}
      <span
        className={sx({
          display: 'flex',
          minWidth: '0',
          flexDirection: 'column',
          gap: tokens.space.step0_5,
        })}
      >
        <code className={sx({ fontFamily: 'mono', fontSize: 'xs' })}>{path}</code>
        <code
          className={sx({
            fontFamily: 'mono',
            fontSize: 'xs',
            color: tokens.foreground.muted,
          })}
        >
          {reference}
        </code>
      </span>
    </li>
  );
}

const meta = {
  title: 'Theme/Token Discovery',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The literal `tokens` tree is the author-facing discovery surface. Expand a
 * domain in autocomplete, then Go to Definition on a leaf; do not author raw
 * custom-property strings or import a second Token map.
 */
export const LiteralTree: Story = {
  render: () => (
    <main
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step6,
        p: tokens.space.step6,
      })}
    >
      <header>
        <h1 className={sx({ fontSize: 'lg' })}>Canonical Token references</h1>
        <p
          className={sx({
            marginTop: tokens.space.step1,
            fontSize: 'sm',
            color: tokens.foreground.muted,
          })}
        >
          Import <code>@emdash/theme</code>, type <code>tokens.</code>, and choose the visual
          domain. Semantic and contextual references are preferred when they express the intent;
          Palette references are public for deliberate visual choices.
        </p>
      </header>
      <div
        className={cx(
          s.cols2,
          sx({
            display: 'grid',
            gap: tokens.space.step4,
          })
        )}
      >
        {TOKEN_GROUPS.map(({ name, leaves }) => (
          <section
            key={name}
            className={cx(
              surface({ level: 'base' }),
              sx({
                borderRadius: tokens.radius.lg,
                borderWidth: '1',
                borderStyle: 'solid',
                borderColor: tokens.border.default,
                p: tokens.space.step4,
              })
            )}
          >
            <h2 className={sx({ fontSize: 'sm' })}>
              tokens.{name} <small>({leaves.length})</small>
            </h2>
            <ul className={sx({ marginTop: tokens.space.step2, p: tokens.space.step0 })}>
              {leaves.map((leaf) => (
                <TokenRow key={leaf.path} {...leaf} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  ),
};
