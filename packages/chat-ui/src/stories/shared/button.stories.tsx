import { controlVariants, type ControlVariantProps } from '@emdash/ui/recipes/control';
/**
 * Button recipe — Solid usage story.
 *
 * Validates that the shared @emdash/ui/recipes/control recipe works correctly
 * when imported from @emdash/chat-ui's Solid context. The Tailwind classes are
 * generated from the recipe source via the @source directive in tailwind.css.
 */
import type { Component, JSX } from 'solid-js';
import { For } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';

type Variant = NonNullable<ControlVariantProps['variant']>;
type Tone = NonNullable<ControlVariantProps['tone']>;
type Size = NonNullable<ControlVariantProps['size']>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const VARIANTS: Variant[] = ['ghost', 'primary'];
const TONES: Tone[] = ['neutral', 'destructive'];
const SIZES: Size[] = ['base', 'sm', 'link'];

const IconPlaceholder: Component = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const Btn: Component<{
  variant?: Variant;
  tone?: Tone;
  size?: Size;
  icon?: boolean;
  disabled?: boolean;
  children?: JSX.Element;
}> = (props) => (
  <button
    disabled={props.disabled}
    class={controlVariants({
      variant: props.variant,
      tone: props.tone,
      size: props.size,
      icon: props.icon,
    })}
  >
    {props.children}
  </button>
);

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: 'Shared/Button',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

// ── Stories ───────────────────────────────────────────────────────────────────

/** All variants at default size. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
      <For each={VARIANTS}>{(variant) => <Btn variant={variant}>{variant}</Btn>}</For>
    </div>
  ),
};

/** Sizes: base / sm / link. */
export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
      <For each={SIZES}>{(size) => <Btn size={size}>{size}</Btn>}</For>
    </div>
  ),
};

/** Full variant × tone × size matrix. */
export const Matrix: Story = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
      <For each={VARIANTS}>
        {(variant) => (
          <For each={TONES}>
            {(tone) => (
              <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                <span
                  style={{ width: '120px', 'font-size': '11px', color: 'var(--foreground-muted)' }}
                >
                  {variant}/{tone}
                </span>
                <For each={SIZES}>
                  {(size) => (
                    <Btn variant={variant} tone={tone} size={size}>
                      {size}
                    </Btn>
                  )}
                </For>
                <Btn variant={variant} tone={tone} icon>
                  <IconPlaceholder />
                </Btn>
              </div>
            )}
          </For>
        )}
      </For>
    </div>
  ),
};

/** Disabled state. */
export const Disabled: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
      <For each={VARIANTS}>
        {(variant) => (
          <button disabled class={controlVariants({ variant })}>
            {variant}
          </button>
        )}
      </For>
    </div>
  ),
};
