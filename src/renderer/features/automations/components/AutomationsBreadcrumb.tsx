import { ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, type ReactNode } from 'react';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { formatRunName } from '@shared/automations/format';
import { useAutomations } from '../useAutomations';

interface Crumb {
  key: string;
  label: string;
  onClick?: () => void;
}

function CrumbButton({
  children,
  onClick,
  isCurrent,
}: {
  children: ReactNode;
  onClick?: () => void;
  isCurrent: boolean;
}) {
  const className = cn(
    'max-w-[14rem] truncate rounded-sm px-1 py-0.5 text-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    isCurrent
      ? 'text-foreground'
      : 'text-foreground-muted hover:bg-background-1 hover:text-foreground'
  );
  if (!onClick || isCurrent) {
    return <span className={className}>{children}</span>;
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export const AutomationsBreadcrumb = observer(function AutomationsBreadcrumb() {
  const { params, setParams } = useParams('automations');
  const { navigate } = useNavigate();
  const { automations } = useAutomations();

  const selected = useMemo(() => {
    if (!params.selectedAutomationId) return undefined;
    return automations.data?.find((a) => a.id === params.selectedAutomationId);
  }, [automations.data, params.selectedAutomationId]);

  const projectId = selected?.projectId ?? null;
  const projectName = projectId ? projectDisplayName(getProjectStore(projectId)) : null;

  const crumbs: Crumb[] = [];
  if (projectId && projectName) {
    crumbs.push({
      key: 'project',
      label: projectName,
      onClick: () => navigate('project', { projectId }),
    });
  }
  crumbs.push({
    key: 'automations',
    label: 'Automations',
    onClick: selected ? () => setParams({ selectedAutomationId: undefined }) : undefined,
  });
  if (selected) {
    crumbs.push({ key: 'automation', label: selected.name });
  }
  if (params.selectedRunId) {
    crumbs.push({ key: 'run', label: formatRunName(params.selectedRunId) });
  }

  return (
    <nav aria-label="Breadcrumb" className="flex items-center px-2">
      <ol className="flex items-center gap-0.5">
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1;
          return (
            <li key={crumb.key} className="flex items-center gap-0.5">
              {index > 0 ? (
                <ChevronRight aria-hidden className="size-3 shrink-0 text-foreground-muted/60" />
              ) : null}
              <CrumbButton onClick={crumb.onClick} isCurrent={isCurrent}>
                {crumb.label}
              </CrumbButton>
            </li>
          );
        })}
      </ol>
    </nav>
  );
});
