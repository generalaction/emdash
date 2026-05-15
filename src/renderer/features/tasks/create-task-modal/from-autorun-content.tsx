import { Loader2, Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import type { Issue } from '@shared/tasks';
import {
  ISSUE_PROVIDER_META,
  ISSUE_PROVIDER_ORDER,
} from '@renderer/features/integrations/issue-provider-meta';
import {
  ConnectIssueIntegrationPlaceholder,
  ProviderLogo,
} from '@renderer/features/tasks/components/issue-selector/issue-selector';
import { getLinkedIssueMap } from '@renderer/features/tasks/components/issue-selector/use-linked-issue-urls';
import { useIssueSearch } from '@renderer/features/tasks/components/issue-selector/useIssueSearch';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@renderer/lib/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { BranchPickerField } from './branch-picker-field';
import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { type FromAutorunModeState } from './use-from-autorun-mode';

interface FromAutorunContentProps {
  state: FromAutorunModeState;
  projectId?: string;
  currentBranch?: string | null;
  repositoryUrl?: string;
  projectPath?: string;
  isUnborn?: boolean;
  initialConversation: InitialConversationState;
  connectionId?: string;
}

export const FromAutorunContent = observer(function FromAutorunContent({
  state,
  projectId,
  currentBranch,
  repositoryUrl = '',
  projectPath = '',
  isUnborn,
  initialConversation,
  connectionId,
}: FromAutorunContentProps) {
  const {
    issues,
    issueProvider,
    hasAnyIntegration,
    isProviderLoading,
    isProviderDisabled,
    setSelectedIssueProvider,
    handleSetSearchTerm,
  } = useIssueSearch(repositoryUrl, projectPath, projectId);

  const linkedIssueMap = getLinkedIssueMap(projectId);

  const [query, setQuery] = useState('');
  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    handleSetSearchTerm(e.target.value);
  };

  // Auto-select all unlinked issues the first time issues arrive for a given provider.
  // Tracks last seen (provider + url set) so switching provider re-applies the default.
  const initializedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!issueProvider) return;
    const key = `${issueProvider}:${issues.map((i) => i.url).join(',')}`;
    if (initializedFor.current === key) return;
    if (issues.length === 0) return;
    initializedFor.current = key;
    const unlinked = issues.filter((i) => !linkedIssueMap.has(i.url));
    state.setSelectedIssues(unlinked);
    // We intentionally re-run when the issue list shape changes; linkedIssueMap is computed each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueProvider, issues]);

  if (!hasAnyIntegration) {
    return <ConnectIssueIntegrationPlaceholder />;
  }

  const selectedUrls = new Set(state.selectedIssues.map((i) => i.url));
  const allChecked = issues.length > 0 && issues.every((i) => selectedUrls.has(i.url));
  const someChecked = issues.some((i) => selectedUrls.has(i.url)) && !allChecked;

  const toggleIssue = (issue: Issue, checked: boolean) => {
    const next = new Map(state.selectedIssues.map((i) => [i.url, i]));
    if (checked) next.set(issue.url, issue);
    else next.delete(issue.url);
    state.setSelectedIssues(Array.from(next.values()));
  };
  const toggleAll = (checked: boolean) => {
    if (checked) {
      const merged = new Map(state.selectedIssues.map((i) => [i.url, i]));
      for (const issue of issues) merged.set(issue.url, issue);
      state.setSelectedIssues(Array.from(merged.values()));
    } else {
      const visible = new Set(issues.map((i) => i.url));
      state.setSelectedIssues(state.selectedIssues.filter((i) => !visible.has(i.url)));
    }
  };

  const isGithub = issueProvider === 'github';

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-border rounded-md overflow-hidden">
        <InputGroup className="rounded-none border-0 border-b border-input shadow-none has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-input">
          <InputGroupAddon align="inline-start">
            {isProviderLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground/60" />
            ) : (
              <Select
                value={issueProvider ?? undefined}
                onValueChange={(v) => v && setSelectedIssueProvider(v as Issue['provider'])}
              >
                <SelectTrigger
                  showChevron={false}
                  className="h-6 gap-1 border-none bg-transparent px-1.5 shadow-none focus:ring-0"
                >
                  {issueProvider ? (
                    <ProviderLogo provider={issueProvider} className="h-3.5 w-3.5" />
                  ) : (
                    <Search className="h-3.5 w-3.5 text-foreground-muted" />
                  )}
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
            )}
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={handleQueryChange}
            placeholder={`Search ${issueProvider ?? 'issues'}…`}
          />
        </InputGroup>
        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border bg-background-1 text-xs">
          <Checkbox
            checked={allChecked}
            indeterminate={someChecked}
            onCheckedChange={(c) => toggleAll(c)}
          />
          <span className="text-foreground-muted">
            {state.selectedIssues.length} of {issues.length} selected
          </span>
        </div>
        <ul className="max-h-60 overflow-auto">
          {issues.length === 0 && (
            <li className="px-3 py-4 text-sm text-foreground-muted text-center">
              {query ? 'No issues match your search.' : `No open issues from ${issueProvider}.`}
            </li>
          )}
          {issues.map((issue) => {
            const checked = selectedUrls.has(issue.url);
            const linkedTo = linkedIssueMap.get(issue.url);
            return (
              <li
                key={issue.url}
                className="flex items-start gap-3 px-3 py-2 border-b border-border last:border-b-0 text-sm"
              >
                <Checkbox checked={checked} onCheckedChange={(c) => toggleIssue(issue, c)} />
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-foreground-muted text-xs shrink-0">
                      {issue.identifier}
                    </span>
                    <span className="truncate">{issue.title}</span>
                  </div>
                  {linkedTo && (
                    <span className="text-xs text-foreground-muted mt-0.5">
                      Already linked to: {linkedTo.taskName}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <BranchPickerField
        state={state}
        projectId={projectId}
        currentBranch={currentBranch}
        isUnborn={isUnborn}
      />

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel>Concurrency</FieldLabel>
          <Input
            type="number"
            min={1}
            max={10}
            value={state.concurrency}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v))
                state.setConcurrency(Math.max(1, Math.min(10, Math.floor(v))));
            }}
          />
        </Field>
        <Field>
          <FieldLabel>
            {isGithub ? 'Create draft PR on agent exit' : 'Draft PR (GitHub only)'}
          </FieldLabel>
          <Switch
            checked={isGithub ? state.autoCreatePr : false}
            disabled={!isGithub}
            onCheckedChange={state.setAutoCreatePr}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel>Additional context for all agents (optional)</FieldLabel>
        <Textarea
          value={state.extraPrompt}
          onChange={(e) => state.setExtraPrompt(e.target.value)}
          placeholder="Prepended to each issue's initial prompt"
          rows={2}
        />
      </Field>

      <InitialConversationField state={initialConversation} connectionId={connectionId} />
    </div>
  );
});
