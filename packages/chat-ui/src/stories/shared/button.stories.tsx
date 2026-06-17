import { buttonVariants, type ButtonVariantProps } from '@emdash/ui/recipes/button';
/**
 * Button recipe — Solid usage story.
 *
 * Validates that the shared @emdash/ui/recipes/button recipe works correctly
 * when imported from @emdash/chat-ui's Solid context. The Tailwind classes are
 * generated from the recipe source via the @source directive in tailwind.css.
 */
import type { Component, JSX } from 'solid-js';
import { For } from 'solid-js';
import type { Meta, StoryObj } from 'storybook-solidjs-vite';

type Variant = NonNullable<ButtonVariantProps['variant']>;
type Size = NonNullable<ButtonVariantProps['size']>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const VARIANTS: Variant[] = ['default', 'outline', 'ghost', 'link'];
const TEXT_SIZES: Size[] = ['sm', 'default', 'lg'];
const ICON_SIZES: Size[] = ['icon-sm', 'icon', 'icon-lg'];

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

const Btn: Component<{ variant?: Variant; size?: Size; children?: JSX.Element }> = (props) => (
  <button class={buttonVariants({ variant: props.variant, size: props.size })}>
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

/** All 4 shared variants at default size. */
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '12px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
      <For each={VARIANTS}>{(variant) => <Btn variant={variant}>{variant}</Btn>}</For>
    </div>
  ),
};

/** 3 logical sizes × text + icon forms. */
export const AllSizes: Story = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
        <For each={TEXT_SIZES}>{(size) => <Btn size={size}>{size}</Btn>}</For>
      </div>
      <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
        <For each={ICON_SIZES}>
          {(size) => (
            <Btn size={size}>
              <IconPlaceholder />
            </Btn>
          )}
        </For>
      </div>
    </div>
  ),
};

/** Full variant × size matrix. */
export const Matrix: Story = {
  render: () => (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
      <For each={VARIANTS}>
        {(variant) => (
          <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
            <span style={{ width: '80px', 'font-size': '11px', color: 'var(--foreground-muted)' }}>
              {variant}
            </span>
            <For each={TEXT_SIZES}>
              {(size) => (
                <Btn variant={variant} size={size}>
                  {size}
                </Btn>
              )}
            </For>
            <For each={ICON_SIZES}>
              {(size) => (
                <Btn variant={variant} size={size}>
                  <IconPlaceholder />
                </Btn>
              )}
            </For>
          </div>
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
          <button disabled class={buttonVariants({ variant })}>
            {variant}
          </button>
        )}
      </For>
    </div>
  ),
};
