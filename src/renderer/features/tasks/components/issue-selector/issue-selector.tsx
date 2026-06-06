import { ExternalLink, Link, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
import { PROVIDER_ICON_COMPONENTS } from '@renderer/features/integrations/provider-icons';
import { InlineMarkdown } from '@renderer/lib/components/inline-markdown';
import {
  IssueStatusIndicator,
  toIssueStatus,
} from '@renderer/lib/components/issue-status-indicator';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@renderer/lib/ui/combobox';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { LinkedIssue } from '@shared/linked-issue';
import { getLinkedIssueMap, type LinkedIssueInfo } from './use-linked-issue-urls';
import { useIssueSearch } from './useIssueSearch';

export function IssueIdentifier({
  identifier,
  provider,
  className,
}: {
  identifier: string;
  provider?: LinkedIssue['provider'];
  className?: string;
}) {
  if (provider === 'asana') return null;
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-xs font-medium whitespace-nowrap text-foreground-muted',
        className
      )}
    >
      {identifier}
    </span>
  );
}

export function ProviderLogo({
  provider,
  className,
}: {
  provider: LinkedIssue['provider'];
  className?: string;
}) {
  const Icon = PROVIDER_ICON_COMPONENTS[provider];

  return (
    <span
      role="img"
      aria-label={ISSUE_PROVIDER_META[provider].displayName}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-visible align-middle leading-none',
        className ?? 'h-3.5 w-3.5'
      )}
    >
      <Icon className="size-[90%]" />
    </span>
  );
}

export function LinkedIssueIndicator({ linkedTo }: { linkedTo: LinkedIssueInfo }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="ml-auto flex shrink-0 items-center text-foreground-info">
            <Link className="size-3.5" />
          </span>
        }
      />
      <TooltipContent>Already linked to task: {linkedTo.taskName}</TooltipContent>
    </Tooltip>
  );
}

export function IssueRow({ issue, linkedTo }: { issue: LinkedIssue; linkedTo?: LinkedIssueInfo }) {
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {issue.status ? (
          <Tooltip>
            <TooltipTrigger
              render={<IssueStatusIndicator status={toIssueStatus(issue.status)} />}
            />
            <TooltipContent>{issue.status}</TooltipContent>
          </Tooltip>
        ) : null}
        <span className="flex min-w-0 items-center gap-2">
          {issue.title ? <span className="truncate text-foreground">{issue.title}</span> : null}
          {linkedTo ? <LinkedIssueIndicator linkedTo={linkedTo} /> : null}
        </span>
      </div>
      <IssueIdentifier identifier={issue.identifier} provider={issue.provider} />
    </span>
  );
}

export type IssueSelectorTriggerContext = {
  issueProvider: LinkedIssue['provider'] | null;
  connectedProviderCount: number;
  isProviderDisabled: (p: LinkedIssue['provider']) => boolean;
  setSelectedIssueProvider: (p: LinkedIssue['provider']) => void;
};

export interface IssueSelectorProps {
  value: LinkedIssue | null;
  onValueChange: (issue: LinkedIssue | null) => void;
  projectId?: string;
  repositoryUrl: string;
  projectPath?: string;
  /** Skip "already linked" indicator for this task — useful when re-selecting the same task's issue. */
  excludeTaskId?: string;
  disabled?: boolean;
  renderSelectedValue?: (issue: LinkedIssue) => ReactNode;
  renderPlaceholder?: (ctx: IssueSelectorTriggerContext) => ReactNode;
}

export const IssueSelector = observer(function IssueSelector({
  projectId,
  repositoryUrl,
  projectPath = '',
  value,
  onValueChange,
  excludeTaskId,
  disabled,
  renderSelectedValue,
  renderPlaceholder,
}: IssueSelectorProps) {
  const linkedIssueMap = getLinkedIssueMap(projectId, excludeTaskId);
  const {
    issues,
    issueProvider,
    hasAnyIntegration,
    isProviderLoading,
    isProviderDisabled,
    connectedProviderCount,
    handleSetSearchTerm,
    setSelectedIssueProvider,
  } = useIssueSearch(repositoryUrl, projectPath, projectId);

  const [comboboxOpen, setComboboxOpen] = useState(false);
  const providerSelectOpenRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSelectIssueProvider = useCallback(
    (provider: LinkedIssue['provider']) => {
      setSelectedIssueProvider(provider);
      if (value?.provider !== provider) {
        onValueChange(null);
      }
    },
    [setSelectedIssueProvider, value, onValueChange]
  );

  const leftAddon = issueProvider ? (
    connectedProviderCount > 1 ? (
      <Select
        value={issueProvider}
        onValueChange={(v) => v && handleSelectIssueProvider(v as LinkedIssue['provider'])}
        onOpenChange={(open) => {
          providerSelectOpenRef.current = open;
          if (open) {
            setComboboxOpen(true);
          } else {
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
      >
        <SelectTrigger
          aria-label="Select issue provider"
          className="h-6 gap-1 border-none bg-transparent px-1.5 shadow-none focus:ring-0"
        >
          <ProviderLogo provider={issueProvider} className="h-3.5 w-3.5" />
        </SelectTrigger>
        <SelectContent>
          {ISSUE_PROVIDER_ORDER.map((p) => (
            <SelectItem key={p} value={p} disabled={isProviderDisabled(p)}>
              <ProviderLogo provider={p} className="h-3.5 w-3.5" />
              <span>{ISSUE_PROVIDER_META[p].displayName}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : (
      <span className="mx-1.5 flex items-center">
        <ProviderLogo provider={issueProvider} className="h-3.5 w-3.5" />
      </span>
    )
  ) : null;

  const triggerContext: IssueSelectorTriggerContext = {
    issueProvider,
    connectedProviderCount,
    isProviderDisabled,
    setSelectedIssueProvider,
  };

  const selectedContent = value ? (
    renderSelectedValue ? (
      renderSelectedValue(value)
    ) : (
      <div className="hover:bg-muted/30 flex w-full min-w-0 items-start rounded-md border border-border p-3 text-left text-sm hover:shadow-xs">
        <SelectedIssueValue issue={value} />
      </div>
    )
  ) : null;

  const placeholderContent = renderPlaceholder ? (
    renderPlaceholder(triggerContext)
  ) : (
    <div className="hover:bg-muted/30 flex h-6 w-full items-center justify-center gap-1 rounded-md border border-dashed border-border p-3 text-center text-sm text-foreground-passive hover:shadow-xs">
      Click to link an issue
    </div>
  );

  return (
    <div className="max-w-full min-w-0 overflow-hidden">
      {hasAnyIntegration ? (
        <Combobox
          autoHighlight
          items={issues}
          filter={null}
          itemToStringLabel={(issue: LinkedIssue | null) =>
            issue ? `${issue.identifier} ${issue.title}` : ''
          }
          value={value}
          onValueChange={(next: LinkedIssue | null) => onValueChange(next)}
          onInputValueChange={(val: string, { reason }: { reason: string }) => {
            if (reason !== 'item-press') handleSetSearchTerm(val);
          }}
          disabled={disabled || !hasAnyIntegration}
          open={comboboxOpen}
          onOpenChange={(open) => {
            if (!open && providerSelectOpenRef.current) return;
            setComboboxOpen(open);
          }}
        >
          <ComboboxTrigger
            render={
              <button className="flex w-full min-w-0 text-left outline-none">
                <ComboboxValue placeholder={placeholderContent}>
                  {value ? selectedContent : null}
                </ComboboxValue>
              </button>
            }
          />
          <ComboboxContent
            side="bottom"
            className="min-w-(--anchor-width) pb-1"
            collisionAvoidance={{ side: 'shift' }}
          >
            <ComboboxInput
              leftAddon={leftAddon}
              rightAddon={
                isProviderLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/60" />
                ) : undefined
              }
              inputRef={inputRef}
              showClear={!!value}
              showTrigger={false}
              placeholder={`Search ${issueProvider ?? 'issues'}…`}
              disabled={!hasAnyIntegration}
            />
            <ComboboxEmpty>
              <span className="text-muted-foreground">No issues found</span>
            </ComboboxEmpty>
            <ComboboxList>
              {(issue: LinkedIssue) => {
                const linkedTo = linkedIssueMap.get(issue.url);
                return (
                  <ComboboxItem
                    key={issue.identifier}
                    value={issue}
                    className="pr-2"
                    showCheck={false}
                  >
                    <IssueRow issue={issue} linkedTo={linkedTo} />
                  </ComboboxItem>
                );
              }}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      ) : (
        <ConnectIssueIntegrationPlaceholder />
      )}
    </div>
  );
});

export function SelectedIssueValue({ issue }: { issue: LinkedIssue }) {
  return (
    <div className="flex w-full flex-col gap-1">
      <div className="flex w-full items-center">
        <div className="flex w-full min-w-0 gap-2">
          {issue.status ? (
            <span className="mt-1 flex size-3.5 shrink-0 items-center justify-center">
              <IssueStatusIndicator status={toIssueStatus(issue.status)} />
            </span>
          ) : null}
          <div className="flex w-full min-w-0 flex-col gap-1 pr-1.5">
            <span className="mt-0.5 flex items-center justify-between gap-2">
              <span className="group flex min-w-0 items-center gap-1">
                <div className="text-muted-foreground min-w-0 truncate">{issue.title}</div>
                <button
                  className="opacity-0 group-hover:opacity-100"
                  disabled={!issue.url}
                  onClick={() => issue.url && rpc.app.openExternal(issue.url)}
                >
                  <ExternalLink className="size-3" />
                </button>
              </span>
              <span className="flex items-center gap-1">
                <ProviderLogo provider={issue.provider} className="size-3 opacity-40" />
                <IssueIdentifier identifier={issue.identifier} provider={issue.provider} />
              </span>
            </span>
            {issue.description ? (
              <InlineMarkdown
                content={issue.description}
                className="line-clamp-1 min-w-0 text-xs text-foreground-muted"
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConnectIssueIntegrationPlaceholder() {
  const { navigate } = useNavigate();

  return (
    <div className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border p-4">
      <div className="flex items-center justify-center [&>span]:ring-2 [&>span]:ring-background-quaternary [&>span:not(:first-child)]:-ml-1.5">
        {ISSUE_PROVIDER_ORDER.map((provider) => (
          <span
            key={provider}
            className="relative flex size-5 items-center justify-center overflow-hidden rounded-full bg-background-quaternary-2"
          >
            <ProviderLogo provider={provider} className="size-3" />
          </span>
        ))}
      </div>

      <Button
        variant="link"
        size="xs"
        className="w-fit"
        onClick={() => navigate('settings', { tab: 'integrations' })}
      >
        Configure integrations
      </Button>
    </div>
  );
}
