import { FolderOpen, Github, Plus, Server, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { EmdashShimmerLogo } from '@renderer/lib/emdash-shimmer-logo';
import { useArrowKeyNavigation } from '@renderer/lib/hooks/use-arrow-key-navigation';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ActionListItem } from '@renderer/lib/ui/action-list-item';

const PROJECT_ACTIONS = [
  {
    label: 'Open project',
    description: 'Create a project from an existing local directory',
    icon: FolderOpen,
    modalArgs: { strategy: 'local', mode: 'pick' },
  },
  {
    label: 'Create repository',
    description: 'Create a project by creating a new repository on GitHub',
    icon: Plus,
    modalArgs: { strategy: 'local', mode: 'new' },
  },
  {
    label: 'Clone from GitHub',
    description: 'Clone a GitHub repository to work on locally',
    icon: Github,
    modalArgs: { strategy: 'local', mode: 'clone' },
  },
  {
    label: 'Add remote project',
    description: 'Create a project on a remote SSH server',
    icon: Server,
    modalArgs: { strategy: 'ssh', mode: 'pick' },
  },
] as const;

export function HomeTitlebar() {
  return <Titlebar />;
}

export function HomeMainPanel() {
  const showAddProjectModal = useShowModal('addProjectModal');
  const { selectedIndex, setSelectedIndex } = useArrowKeyNavigation(
    PROJECT_ACTIONS.length,
    (index) => showAddProjectModal(PROJECT_ACTIONS[index].modalArgs)
  );
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';

  return (
    <motion.div
      className="flex h-full flex-col overflow-y-auto bg-background text-foreground"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div className="container mx-auto flex min-h-full max-w-6xl flex-1 flex-col justify-center px-8 py-8">
        <div className="mb-3 text-center">
          <div className="mb-3 flex items-center justify-center">
            <EmdashShimmerLogo
              height={32}
              color={isDark ? 'var(--color-background-2)' : 'var(--color-foreground)'}
              shimmerColor={isDark ? 'white' : 'var(--color-foreground-passive)'}
            />
          </div>
        </div>
        <div className="mx-auto mt-8 flex w-full max-w-md flex-col gap-1">
          {PROJECT_ACTIONS.map((action, i) => (
            <HomeProjectAction
              key={action.label}
              label={action.label}
              description={action.description}
              icon={action.icon}
              isSelected={i === selectedIndex}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => showAddProjectModal(action.modalArgs)}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function HomeProjectAction({
  label,
  description,
  icon,
  isSelected,
  onClick,
  onMouseEnter,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <ActionListItem
      label={label}
      description={description}
      icon={icon}
      isSelected={isSelected}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    />
  );
}

export const homeView = {
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
