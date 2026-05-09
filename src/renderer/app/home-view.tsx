import { FolderOpen, Github, Plus, Server, type LucideIcon } from 'lucide-react';
import emdashLogoWhite from '@/assets/images/emdash/emdash_logo_white.svg';
import emdashLogo from '@/assets/images/emdash/emdash_logo.svg';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useShowModal } from '@renderer/lib/modal/modal-provider';

const PROJECT_ACTIONS = [
  {
    label: 'Open project',
    icon: FolderOpen,
    modalArgs: { strategy: 'local', mode: 'pick' },
  },
  {
    label: 'Create New Project',
    icon: Plus,
    modalArgs: { strategy: 'local', mode: 'new' },
  },
  {
    label: 'Clone from GitHub',
    icon: Github,
    modalArgs: { strategy: 'local', mode: 'clone' },
  },
  {
    label: 'Add Remote Project',
    icon: Server,
    modalArgs: { strategy: 'ssh', mode: 'pick' },
  },
] as const;

export function HomeTitlebar() {
  return <Titlebar />;
}

export function HomeMainPanel() {
  const { effectiveTheme } = useTheme();
  const showAddProjectModal = useShowModal('addProjectModal');

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="container mx-auto flex min-h-full max-w-6xl flex-1 flex-col justify-center px-8 py-8">
        <div className="mb-3 text-center">
          <div className="mb-3 flex items-center justify-center">
            <div className="logo-shimmer-container">
              <img
                key={effectiveTheme}
                src={effectiveTheme === 'emdark' ? emdashLogoWhite : emdashLogo}
                alt="Emdash"
                className="logo-shimmer-image"
              />
              <span
                className="logo-shimmer-overlay"
                aria-hidden="true"
                style={{
                  WebkitMaskImage: `url(${effectiveTheme === 'emdark' ? emdashLogoWhite : emdashLogo})`,
                  maskImage: `url(${effectiveTheme === 'emdark' ? emdashLogoWhite : emdashLogo})`,
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              />
            </div>
          </div>
          <p className="whitespace-nowrap text-xs text-muted-foreground">
            Agentic Development Environment
          </p>
        </div>
        <div className="mx-auto mt-4 grid w-full max-w-[600px] grid-cols-2 gap-2 sm:grid-cols-[repeat(4,minmax(132px,1fr))]">
          {PROJECT_ACTIONS.map((action) => (
            <HomeProjectAction
              key={action.label}
              label={action.label}
              icon={action.icon}
              onClick={() => showAddProjectModal(action.modalArgs)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HomeProjectAction({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="group flex h-[68px] w-full flex-col items-start rounded-md border border-border/80 bg-background px-3.5 py-3 text-left shadow-sm transition-all hover:border-border-1 hover:bg-background-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Icon className="size-4 text-foreground-muted transition-colors group-hover:text-foreground" />
      <span className="mt-auto whitespace-nowrap pt-4 text-[11px] font-semibold leading-none tracking-normal text-foreground">
        {label}
      </span>
    </button>
  );
}

export const homeView = {
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};
