import { tokens } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { cx, sx } from '@styles/index';
import { surface } from '@styles/recipes/surface';
import React from 'react';
import { Heading } from '../primitives/typography/Heading';
import { Text, type TextVariant } from '../primitives/typography/Text';
import { StoryThemeScope } from '../story-theme';
import * as s from '../story-layout.css';

const meta: Meta = {
  title: 'Theme/Typography',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

const SIZE_TOKENS = [
  { name: '--text-micro', size: '10px', lh: '1.2' },
  { name: '--text-tiny', size: '11px', lh: '1.3' },
  { name: '--text-xs', size: '12px', lh: '1.5' },
  { name: '--text-sm', size: '13px', lh: '1.5' },
  { name: '--text-base', size: '14px', lh: '1.5' },
  { name: '--text-lg', size: '17px', lh: '1.5' },
  { name: '--text-xl', size: '20px', lh: '1.4' },
  { name: '--text-2xl', size: '24px', lh: '1.3' },
];

const WEIGHT_TOKENS = [{ name: '--font-weight-normal', value: 400, label: 'Normal 400' }];

/** Primitive type size scale — each --text-* token. */
export const TypeScale: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step2,
        p: tokens.space.step4,
      })}
    >
      <div className={sx({ marginBottom: tokens.space.step4 })}>
        <h2
          className={cx(
            sx({ fontSize: tokens.typography.size.sm, color: tokens.foreground.default })
          )}
        >
          Type size scale
        </h2>
        <p
          className={cx(
            sx({
              marginTop: tokens.space.step1,
              fontSize: tokens.typography.size.xs,
              color: tokens.foreground.muted,
            })
          )}
        >
          Primitive <code className={cx(sx({ fontFamily: 'mono' }))}>--text-*</code> tokens.
          Semantic{' '}
          <code className={cx(sx({ fontFamily: 'mono' }))}>--type-&lt;role&gt;-font-size</code>{' '}
          values reference these.
        </p>
      </div>
      {SIZE_TOKENS.map(({ name, size, lh }) => (
        <div
          key={name}
          className={sx({
            display: 'flex',
            alignItems: 'baseline',
            gap: tokens.space.step4,
          })}
        >
          <div
            className={cx(s.w48, sx({ display: 'flex', flexDirection: 'column', flexShrink: 0 }))}
            style={{ textAlign: 'right' }}
          >
            <code
              className={cx(
                sx({
                  fontFamily: 'mono',
                  fontSize: tokens.typography.size.xs,
                  color: tokens.foreground.passive,
                })
              )}
            >
              {name}
            </code>
            <span
              className={cx(
                sx({
                  fontSize: tokens.typography.size.xs,
                  color: tokens.foreground.passive,
                })
              )}
            >
              {size} / {lh}
            </span>
          </div>
          <span
            style={{ fontSize: `var(${name})`, lineHeight: `var(${name}--line-height, ${lh})` }}
            className={cx(sx({ color: tokens.foreground.default }))}
          >
            The quick brown fox jumps over the lazy dog.
          </span>
        </div>
      ))}
    </div>
  ),
};

/** Font weight scale — each --font-weight-* token. */
export const Weights: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step4,
        p: tokens.space.step4,
      })}
    >
      <div className={sx({ marginBottom: tokens.space.step2 })}>
        <h2
          className={cx(
            sx({ fontSize: tokens.typography.size.sm, color: tokens.foreground.default })
          )}
        >
          Font weight scale
        </h2>
        <p
          className={cx(
            sx({
              marginTop: tokens.space.step1,
              fontSize: tokens.typography.size.xs,
              color: tokens.foreground.muted,
            })
          )}
        >
          Primitive <code className={cx(sx({ fontFamily: 'mono' }))}>--font-weight-*</code> tokens.
        </p>
      </div>
      {WEIGHT_TOKENS.map(({ name, value, label }) => (
        <div
          key={name}
          className={sx({
            display: 'flex',
            alignItems: 'baseline',
            gap: tokens.space.step4,
          })}
        >
          <div
            className={cx(s.w48, sx({ display: 'flex', flexDirection: 'column', flexShrink: 0 }))}
            style={{ textAlign: 'right' }}
          >
            <code
              className={cx(
                sx({
                  fontFamily: 'mono',
                  fontSize: tokens.typography.size.xs,
                  color: tokens.foreground.passive,
                })
              )}
            >
              {name}
            </code>
            <span
              className={cx(
                sx({
                  fontSize: tokens.typography.size.xs,
                  color: tokens.foreground.passive,
                })
              )}
            >
              {value}
            </span>
          </div>
          <span
            style={{ fontWeight: `var(${name})`, fontSize: '14px' }}
            className={cx(sx({ color: tokens.foreground.default }))}
          >
            {label}: The quick brown fox jumps over the lazy dog.
          </span>
        </div>
      ))}
    </div>
  ),
};

const ROLES: Array<{ label: string; variant: TextVariant; as?: string }> = [
  { label: 'h1 — 20px / 400', variant: 'h1', as: 'p' },
  { label: 'h2 — 17px / 400', variant: 'h2', as: 'p' },
  { label: 'h3 — 14px / 400', variant: 'h3', as: 'p' },
  { label: 'section — 13px / 400', variant: 'section', as: 'p' },
  { label: 'body — 14px / 400', variant: 'body', as: 'p' },
  { label: 'bodyItalic — 14px / 400 italic', variant: 'bodyItalic', as: 'p' },
  { label: 'bodyLink — 14px / 400', variant: 'bodyLink', as: 'p' },
  { label: 'caption — 12px / 400', variant: 'caption', as: 'p' },
  { label: 'description — 13px / 400', variant: 'description', as: 'p' },
  { label: 'inlineCode — 12px / 400 mono', variant: 'inlineCode', as: 'p' },
  { label: 'code — 13px / 400 mono', variant: 'code', as: 'p' },
  { label: 'codeLang — 11px / 400 sans', variant: 'codeLang', as: 'p' },
  { label: 'mention — 14px / 400', variant: 'mention', as: 'p' },
];

/** Every typography role applied to a sample sentence. */
export const AllRoles: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step4,
      })}
    >
      {ROLES.map(({ label, variant }) => (
        <div
          key={variant}
          className={sx({
            display: 'flex',
            alignItems: 'baseline',
            gap: tokens.space.step4,
          })}
        >
          <span
            className={cx(
              sx({
                fontFamily: 'mono',
                fontSize: tokens.typography.size.xs,
                color: tokens.foreground.passive,
                flexShrink: 0,
              }),
              s.w52
            )}
          >
            {label}
          </span>
          <Text as="p" variant={variant} tone="default">
            The quick brown fox jumps over the lazy dog.
          </Text>
        </div>
      ))}
    </div>
  ),
};

/** Heading component: levels 1–4. */
export const Headings: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step3,
      })}
    >
      <Heading level={1}>Heading level 1 — 20px / 400</Heading>
      <Heading level={2}>Heading level 2 — 17px / 400</Heading>
      <Heading level={3}>Heading level 3 — 14px / 400</Heading>
      <Heading level={4}>Heading level 4 — 13px / 400</Heading>
    </div>
  ),
};

/** Tone variants — default, muted, passive. */
export const Tones: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step2,
      })}
    >
      {(['default', 'muted', 'passive'] as const).map((tone) => (
        <Text key={tone} as="p" variant="body" tone={tone}>
          tone="{tone}": The quick brown fox jumps over the lazy dog.
        </Text>
      ))}
    </div>
  ),
};

/** className extension — role + extra utility classes. */
export const ClassExtension: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step2,
      })}
    >
      <Text
        as="p"
        variant="body"
        className={cx(sx({ fontStyle: 'italic', textDecoration: 'underline' }))}
      >
        className extension: italic + underline applied after role.
      </Text>
      <Heading level={2} className={cx(sx({ color: tokens.foreground.muted }))}>
        Muted h2 via className
      </Heading>
    </div>
  ),
};

/** Semantic typography props stay on the public React component interface. */
export const ComponentInterface: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.step2,
      })}
    >
      <Text as="p" variant="h1" tone="default">
        Text — h1 role, default tone
      </Text>
      <Text as="p" variant="body" tone="muted">
        Text — body role, muted tone
      </Text>
    </div>
  ),
};

/** All surfaces side-by-side to confirm readability. */
export const AllSurfaces: Story = {
  render: () => (
    <div className={cx(s.cols5, sx({ display: 'grid', gap: tokens.space.step3 }))}>
      {(['sunken', 'base', 'raised', 'elevated', 'overlay'] as const).map((sv) => (
        <div
          key={sv}
          className={cx(
            surface({ level: sv }),
            sx({ borderRadius: tokens.radius.lg, p: tokens.space.step4 })
          )}
        >
          <p
            className={cx(
              sx({
                marginBottom: tokens.space.step1,
                fontFamily: 'mono',
                fontSize: tokens.typography.size.xs,
                color: tokens.foreground.passive,
              })
            )}
          >
            .surface-{sv}
          </p>
          <Heading level={2} className={cx(sx({ marginBottom: tokens.space.step1 }))}>
            Heading
          </Heading>
          <Text as="p" variant="body" tone="default">
            Body text on this surface.
          </Text>
          <Text as="p" variant="body" tone="muted">
            Muted body text.
          </Text>
        </div>
      ))}
    </div>
  ),
};

/** Light and dark modes side-by-side. */
export const BothModes: Story = {
  render: () => (
    <div className={cx(s.minHScreen, sx({ display: 'flex' }))}>
      <StoryThemeScope
        colorScheme="light"
        className={cx(
          sx({
            flex: '1',
            background: tokens.palette.neutral.step1,
            p: tokens.space.step8,
          })
        )}
      >
        <Heading level={1} className={cx(sx({ marginBottom: tokens.space.step2 }))}>
          Light mode
        </Heading>
        <Text
          as="p"
          variant="body"
          tone="default"
          className={cx(sx({ marginBottom: tokens.space.step1 }))}
        >
          Body text
        </Text>
        <Text as="p" variant="body" tone="muted">
          Muted body text
        </Text>
      </StoryThemeScope>
      <StoryThemeScope
        colorScheme="dark"
        className={cx(
          s.borderLeft,
          sx({
            flex: '1',
            background: tokens.palette.neutral.step1,
            p: tokens.space.step8,
          })
        )}
      >
        <Heading level={1} className={cx(sx({ marginBottom: tokens.space.step2 }))}>
          Dark mode
        </Heading>
        <Text
          as="p"
          variant="body"
          tone="default"
          className={cx(sx({ marginBottom: tokens.space.step1 }))}
        >
          Body text
        </Text>
        <Text as="p" variant="body" tone="muted">
          Muted body text
        </Text>
      </StoryThemeScope>
    </div>
  ),
};
