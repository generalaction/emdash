import { tokens } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
import { FolderOpenIcon, MoreHorizontalIcon } from 'lucide-react';
import * as React from 'react';
import { MachineStatus, StatusIcon } from '../../components';
import { Button, Heading, Icon } from '../../primitives';
import { EntityHeader } from './entity-header';
import * as styles from './entity-header.css';

const meta: Meta<typeof EntityHeader> = {
  title: 'Patterns/EntityHeader',
  component: EntityHeader,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 'min(42rem, calc(100vw - 2rem))' }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof EntityHeader>;

const projectIcon = <StatusIcon severity="neutral" size="lg" icon={FolderOpenIcon} />;

const actionButton = (
  <Button type="button" variant="secondary" size="xs" icon aria-label="Entity actions">
    <Icon source={MoreHorizontalIcon} />
  </Button>
);

export const Project: Story = {
  args: {
    icon: projectIcon,
    title: (
      <Heading level={1} tone="default">
        Emdash
      </Heading>
    ),
    actions: actionButton,
  },
};

export const Machine: Story = {
  args: {
    icon: <MachineStatus size="2rem" status="successful" />,
    title: (
      <Heading level={1} tone="default">
        Development machine
      </Heading>
    ),
    actions: actionButton,
  },
};

export const LongTitleWithoutActions: Story = {
  args: {
    icon: projectIcon,
    title: (
      <Heading
        level={1}
        tone="default"
        style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        A project with a deliberately long name that demonstrates constrained title overflow
      </Heading>
    ),
  },
};

function EditableTitleExample() {
  const [name, setName] = React.useState('Development machine');

  return (
    <EntityHeader
      icon={<MachineStatus size="2rem" status="successful" />}
      title={
        <input
          aria-label="Machine name"
          className={styles.editableTitleInput}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      }
      actions={actionButton}
    />
  );
}

export const EditableTitle: Story = {
  render: () => <EditableTitleExample />,
};

/** Caller-owned padding through the documented semantic header root. */
export const SxOverride: Story = {
  args: {
    icon: projectIcon,
    title: <Heading level={1}>Caller-owned title structure</Heading>,
    actions: actionButton,
    className: sx({ p: tokens.space.step3 }),
  },
};
