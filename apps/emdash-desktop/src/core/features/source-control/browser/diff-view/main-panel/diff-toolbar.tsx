import {
  Button,
  MicroLabel,
  Spinner,
  toast,
  ToggleGroup,
  Tooltip,
} from '@emdash/ui/react/primitives';
import { AlignJustify, Columns2, Sparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  findIdleAcpChat,
  requestAcpReply,
} from '@core/features/conversations/api/browser/acp-prompt-request';
import {
  buildExplainPrompt,
  parseAiAnnotations,
} from '@core/features/source-control/api/browser/diff-view/ai-annotations';
import type { AiAnnotationsStore } from '@core/features/source-control/api/browser/diff-view/stores/ai-annotations-store';
import { aiAnnotationsStoreToken } from '@core/features/source-control/contributions/browser/task-stores';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import {
  getDraftCommentTargetKey,
  type DraftCommentTarget,
} from '@core/primitives/line-comments/api';
import type { DiffTabResource } from '../stores/diff-tab-resource';
import { diffTabToCommentTarget } from './diff-comment-target';

interface DiffToolbarProps {
  tab: DiffTabResource;
}

export const DiffToolbar = observer(function DiffToolbar({ tab }: DiffToolbarProps) {
  const diffView = useTaskComposition().diffView;
  const diffStyle = diffView?.diffStyle;
  const canPreview = tab.renderer.kind === 'text' && tab.renderer.previewKind !== undefined;

  const diffSourceLabel = (() => {
    if (tab.diffGroup === 'staged') return 'Staged';
    if (tab.diffGroup === 'disk') return 'Changed';
    if (tab.diffGroup === 'pr') return 'PR';
    if (tab.diffGroup === 'git') return 'Git';
    return undefined;
  })();

  if (!diffView || !diffStyle) return null;

  return (
    <div className="flex h-[41px] items-center justify-between gap-2 border-b border-border bg-(--em-surface) px-2">
      <div className="flex items-center gap-3">
        {diffSourceLabel && <MicroLabel>{diffSourceLabel}</MicroLabel>}
      </div>
      <div className="flex items-center gap-2">
        {tab.renderer.kind === 'text' && tab.viewMode === 'diff' && (
          <ExplainChangesButton tab={tab} />
        )}
        {canPreview && (
          <ToggleGroup.Root
            multiple={false}
            value={[tab.viewMode]}
            onValueChange={([value]) => {
              if (value === 'diff' || value === 'preview') tab.setViewMode(value);
            }}
          >
            <ToggleGroup.Item size="sm" value="diff" className="text-xs">
              Diff
            </ToggleGroup.Item>
            <ToggleGroup.Item size="sm" value="preview" className="text-xs">
              Preview
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        )}
        {tab.viewMode === 'diff' && (
          <ToggleGroup.Root
            multiple={false}
            value={[diffStyle]}
            onValueChange={([value]) => {
              if (value) {
                diffView.setDiffStyle(value as 'unified' | 'split');
              }
            }}
          >
            <ToggleGroup.Item size="sm" icon value="unified" aria-label="Unified diff">
              <AlignJustify className="h-3.5 w-3.5" />
            </ToggleGroup.Item>
            <ToggleGroup.Item size="sm" icon value="split" aria-label="Split diff">
              <Columns2 className="h-3.5 w-3.5" />
            </ToggleGroup.Item>
          </ToggleGroup.Root>
        )}
      </div>
    </div>
  );
});

async function explainTarget(
  taskId: string,
  target: DraftCommentTarget,
  annotations: AiAnnotationsStore
): Promise<void> {
  const chat = findIdleAcpChat(taskId);
  if (!chat) return;
  const targetKey = getDraftCommentTargetKey(target);
  annotations.setPending(targetKey, true);
  try {
    const { text, hiddenContext } = buildExplainPrompt(target);
    const reply = await requestAcpReply(chat, text, hiddenContext);
    const parsed = reply ? parseAiAnnotations(reply, new Set([target.path])) : [];
    if (parsed.length === 0) {
      toast.error('No inline explanations returned', {
        description: 'The agent reply did not include any usable annotations for this file.',
      });
      return;
    }
    annotations.setForTarget(targetKey, parsed);
  } finally {
    annotations.setPending(targetKey, false);
  }
}

const ExplainChangesButton = observer(function ExplainChangesButton({ tab }: DiffToolbarProps) {
  const { projectId, taskId } = useTaskViewContext();
  const annotations = getTaskStore(projectId, taskId)?.get(aiAnnotationsStoreToken);
  if (!annotations) return null;

  const target = diffTabToCommentTarget(tab);
  const pending = annotations.isPending(getDraftCommentTargetKey(target));
  const chatAvailable = findIdleAcpChat(taskId) !== undefined;
  const tooltip = pending
    ? 'Waiting for the agent'
    : chatAvailable
      ? 'Ask the agent to explain this file inline'
      : 'Needs an idle chat conversation with an empty composer';

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            disabled={pending}
            // aria-disabled keeps the tooltip reachable when no chat can take the prompt.
            aria-disabled={!chatAvailable}
            onClick={() => {
              if (chatAvailable) void explainTarget(taskId, target, annotations);
            }}
          >
            {pending ? <Spinner size="sm" /> : <Sparkles className="h-3.5 w-3.5" />}
            Explain
          </Button>
        }
      />
      <Tooltip.Content>{tooltip}</Tooltip.Content>
    </Tooltip.Root>
  );
});
