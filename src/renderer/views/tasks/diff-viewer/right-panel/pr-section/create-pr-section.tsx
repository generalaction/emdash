import { ChevronDown, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { useModalContext } from '@renderer/core/modal/modal-provider';

type PrMode = 'pr' | 'draft';

const prModeLabels: Record<PrMode, string> = {
  pr: 'Create PR',
  draft: 'Create Draft PR',
};

interface CreatePullRequestSectionProps {
  nameWithOwner: string;
  branchName: string;
}

export const CreatePullRequestSection = ({
  nameWithOwner,
  branchName,
}: CreatePullRequestSectionProps) => {
  const [mode, setMode] = useState<PrMode>('pr');
  const { showModal } = useModalContext();

  return (
    <>
      <div className="shrink-0 flex items-center gap-0 p-2">
        <Button
          variant="default"
          size="sm"
          className="flex-1 min-w-0 shrink rounded-r-none gap-1.5"
          onClick={() =>
            showModal('createPrModal', {
              nameWithOwner,
              branchName,
              draft: mode === 'draft',
            })
          }
        >
          <GitPullRequest className="size-3.5" />
          {prModeLabels[mode]}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="default"
                size="sm"
                className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
              />
            }
          >
            <ChevronDown className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto whitespace-nowrap">
            <DropdownMenuItem onClick={() => setMode('pr')}>Create PR</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMode('draft')}>Create Draft PR</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
};
