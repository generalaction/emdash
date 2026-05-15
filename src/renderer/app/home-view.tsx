import { FolderOpen, Github, Plus, Server, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { EmdashShimmerLogo } from '@renderer/lib/emdash-shimmer-logo';
import { useArrowKeyNavigation } from '@renderer/lib/hooks/use-arrow-key-navigation';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Kbd } from '@renderer/lib/ui/kbd';
import { cn } from '@renderer/utils/utils';

const PROJECT_ACTIONS = [
  {
    label: 'Open project',
    description: 'Create a project from an existing local directory',
    icon: FolderOpen,
    modalArgs: { strategy: 'local', mode: 'pick' },
  },
  {
    label: 'Create Repository',
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
    label: 'Add Remote Project',
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
        <div className="mx-auto mt-8 flex flex-col w-full max-w-md gap-1">
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
  icon: Icon,
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
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'group flex w-full items-center justify-between rounded-lg bg-background hover:bg-background-1 p-4 text-left transition-all ',
        isSelected && 'bg-background-1'
      )}
    >
      <div className="flex items-center gap-3">
        <Icon className="size-7.5 text-foreground-passive transition-colors" strokeWidth={1} />
        <div className="flex flex-col gap-1.5">
          <span
            className={cn(
              ' whitespace-nowrap leading-none tracking-normal text-sm text-foreground-muted transition-colors',
              isSelected && 'text-foreground'
            )}
          >
            {label}
          </span>
          <span className="text-xs text-foreground-passive">{description}</span>
        </div>
      </div>
      {isSelected && (
        <Kbd className="text-foreground-muted group-hover:text-foreground bg-background-2 size-6 pt-1">
          ↵
        </Kbd>
      )}
    </button>
  );
}

export const homeView = {
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
