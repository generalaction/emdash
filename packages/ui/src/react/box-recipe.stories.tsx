import type { Meta, StoryObj } from '@storybook/react-vite';
import { box } from '../styles/recipes/box.css';

const meta: Meta = {
  title: 'Styles/Box Recipe',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj;

// ── Layout variants ────────────────────────────────────────────────────────────

function Tile({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={className}
      style={{
        width: '3rem',
        height: '3rem',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-emphasis)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 'var(--text-xs)',
        color: 'var(--foreground-muted)',
      }}
    >
      {label}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--foreground-muted)' }}>
        {title}
      </p>
      {children}
    </div>
  );
}

function BoxRecipeDemo() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', minWidth: '28rem' }}>
      <Section title="display=flex direction=row gap='2'">
        <div className={box({ display: 'flex', direction: 'row', gap: '2' })}>
          <Tile label="A" />
          <Tile label="B" />
          <Tile label="C" />
        </div>
      </Section>

      <Section title="display=flex direction=column gap='3'">
        <div className={box({ display: 'flex', direction: 'column', gap: '3' })}>
          <Tile label="A" />
          <Tile label="B" />
          <Tile label="C" />
        </div>
      </Section>

      <Section title="align=center justify=between">
        <div className={box({ align: 'center', justify: 'between' })} style={{ width: '20rem' }}>
          <Tile label="L" />
          <Tile label="R" />
        </div>
      </Section>

      <Section title="gap='4' padding='3' border=true radius='md'">
        <div
          className={box({
            direction: 'column',
            gap: '4',
            padding: '3',
            border: true,
            radius: 'md',
          })}
        >
          <Tile label="A" />
          <Tile label="B" />
        </div>
      </Section>

      <Section title="background=input border=true radius='md' padding='2'">
        <div
          className={box({
            direction: 'column',
            gap: '2',
            padding: '2',
            background: 'input',
            border: true,
            radius: 'md',
          })}
        >
          <Tile label="A" />
          <Tile label="B" />
        </div>
      </Section>

      <Section title="wrap=true gap='2'">
        <div className={box({ wrap: true, gap: '2' })} style={{ width: '10rem' }}>
          {['A', 'B', 'C', 'D', 'E', 'F'].map((l) => (
            <Tile key={l} label={l} />
          ))}
        </div>
      </Section>
    </div>
  );
}

export const BoxRecipe: Story = {
  render: () => <BoxRecipeDemo />,
};
