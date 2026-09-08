import { tokens } from '@emdash/theme';
import { Button } from '@react/primitives/button';
import { Icon, type StaticSvgComponent } from '@react/primitives/icon';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
import { Blocks, Globe, Plus, Terminal, Wrench } from 'lucide-react';
import { CardGrid, CardGridItem, CardGridSection } from './card-grid';

const meta: Meta<typeof CardGrid> = {
  title: 'Components/CardGrid',
  component: CardGrid,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof CardGrid>;

function DemoCardContent({
  icon: source = Blocks,
  name,
  description,
}: {
  icon?: StaticSvgComponent;
  name: string;
  description: string;
}) {
  return (
    <>
      <Icon source={source} size="xl" strokeWidth={1.5} />
      <div
        style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}
      >
        <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500 }}>{name}</h3>
        <p
          style={{
            margin: 0,
            fontSize: '0.75rem',
            color: 'var(--em-foreground-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {description}
        </p>
      </div>
    </>
  );
}

export const Default: Story = {
  render: () => (
    <CardGrid>
      <CardGridItem interactive>
        <DemoCardContent name="Filesystem" description="Read and write files in the workspace" />
      </CardGridItem>
      <CardGridItem interactive>
        <DemoCardContent name="Fetch" description="Fetch URLs and convert HTML to markdown" />
      </CardGridItem>
      <CardGridItem interactive>
        <DemoCardContent name="Sequential thinking" description="Structured multi-step reasoning" />
      </CardGridItem>
    </CardGrid>
  ),
};

export const Sections: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <CardGridSection title="Installed">
        <CardGridItem interactive>
          <DemoCardContent icon={Terminal} name="Shell" description="Run shell commands" />
        </CardGridItem>
        <CardGridItem interactive>
          <DemoCardContent icon={Globe} name="Browser" description="Automate a headless browser" />
        </CardGridItem>
      </CardGridSection>
      <CardGridSection title="Recommended">
        <CardGridItem interactive>
          <DemoCardContent
            icon={Wrench}
            name="Linter"
            description="Static analysis for your code"
          />
        </CardGridItem>
      </CardGridSection>
    </div>
  ),
};

export const WithTrailingAction: Story = {
  render: () => (
    <CardGrid>
      <CardGridItem interactive style={{ position: 'relative' }}>
        <DemoCardContent name="Fetch" description="Fetch URLs and convert HTML to markdown" />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: '0.5rem',
            transform: 'translateY(-50%)',
          }}
        >
          <Button size="sm" icon variant="ghost" aria-label="Install">
            <Icon source={Plus} />
          </Button>
        </div>
      </CardGridItem>
    </CardGrid>
  ),
};

/** Caller-owned padding through the documented CardGrid root className seam. */
export const SxOverride: Story = {
  render: () => (
    <CardGrid className={sx({ p: tokens.space.step4 })}>
      <CardGridItem interactive selected>
        <DemoCardContent name="Selected card" description="The item owns its semantic state." />
      </CardGridItem>
      <CardGridItem interactive disabled>
        <DemoCardContent name="Disabled card" description="Unavailable but still visible." />
      </CardGridItem>
    </CardGrid>
  ),
};
