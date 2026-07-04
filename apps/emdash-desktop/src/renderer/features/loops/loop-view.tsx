import { ArrowLeft, MessageSquare, Pause, Play, RefreshCw, Square } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { GuardResult, ViewDefinition } from '@renderer/app/view-registry';
import { ProjectViewWrapper } from '@renderer/features/projects/components/project-view-wrapper';
import {
  getConversationsForTask,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type { LoopPhase, LoopPhaseCriterion, LoopWithPhases } from '@shared/core/loops/loops';
import {
  loopPhaseProgress,
  loopStatusMeta,
  parseVerifierEvidence,
  phaseStatusMeta,
  statusToneClass,
  verifierLabel,
} from './loop-format';
import { loopsStore } from './loops-store';

export type LoopViewParams = {
  projectId: string;
  taskId: string;
  loopId: string;
};

const LoopViewContext = createContext<LoopViewParams | null>(null);

function useLoopViewParams(): LoopViewParams {
  const context = useContext(LoopViewContext);
  if (!context) throw new Error('useLoopViewParams must be used inside LoopViewWrapper');
  return context;
}

function hasLoopViewParams(params: unknown): params is LoopViewParams {
  if (!params || typeof params !== 'object') return false;
  const record = params as Record<string, unknown>;
  return (
    typeof record.projectId === 'string' &&
    typeof record.taskId === 'string' &&
    typeof record.loopId === 'string'
  );
}

export function LoopViewWrapper({
  children,
  projectId,
  taskId,
  loopId,
}: {
  children: ReactNode;
} & LoopViewParams) {
  return (
    <ProjectViewWrapper projectId={projectId}>
      <LoopViewContext.Provider value={{ projectId, taskId, loopId }}>
        {children}
      </LoopViewContext.Provider>
    </ProjectViewWrapper>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: ReturnType<typeof loopStatusMeta>['tone'];
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs',
        statusToneClass(tone)
      )}
    >
      {label}
    </span>
  );
}

function LoopTitlebar() {
  const { projectId, taskId } = useLoopViewParams();
  return (
    <Titlebar
      leftSlot={
        <div className="flex min-w-0 items-center gap-2 px-2">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => appState.navigation.navigate('task', { projectId, taskId })}
            aria-label="Back to task"
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <span className="truncate text-sm text-foreground-muted">Loop</span>
        </div>
      }
    />
  );
}

async function openPhaseConversation(
  projectId: string,
  taskId: string,
  conversationId: string
): Promise<void> {
  const conversations = getConversationsForTask(taskId);
  if (conversations && !conversations.conversations.has(conversationId)) {
    await conversations.list.load();
  }

  const conversation = conversations?.conversations.get(conversationId);
  const paneLayout = getTaskStore(projectId, taskId)?.viewModel?.paneLayout;
  if (paneLayout) {
    if (conversation?.data.type === 'pty') {
      paneLayout.open('conversation', { conversationId }, { preview: false });
    } else {
      paneLayout.open('acp-chat', { conversationId }, { preview: false });
    }
  }
  appState.navigation.navigate('task', { projectId, taskId });
}

function LoopControls({ loop }: { loop: LoopWithPhases }) {
  const pending = loopsStore.isActionPending(loop.id);
  const canStart = loop.status === 'draft' || loop.status === 'failed';
  const canPause = loop.status === 'running';
  const canResume = loop.status === 'paused';
  const canCancel = loop.status === 'running' || loop.status === 'paused';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canStart ? (
        <Button size="sm" disabled={pending} onClick={() => void loopsStore.startLoop(loop.id)}>
          <Play className="size-3.5" />
          Start
        </Button>
      ) : null}
      {canPause ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => void loopsStore.pauseLoop(loop.id)}
        >
          <Pause className="size-3.5" />
          Pause
        </Button>
      ) : null}
      {canResume ? (
        <Button size="sm" disabled={pending} onClick={() => void loopsStore.resumeLoop(loop.id)}>
          <Play className="size-3.5" />
          Resume
        </Button>
      ) : null}
      {canCancel ? (
        <Button
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => void loopsStore.cancelLoop(loop.id)}
        >
          <Square className="size-3.5" />
          Cancel
        </Button>
      ) : null}
    </div>
  );
}

function EvidenceBlock({ criterion }: { criterion: LoopPhaseCriterion }) {
  const evidence = parseVerifierEvidence(criterion.evidence);
  const output = [evidence?.stdoutTail, evidence?.stderrTail].filter(Boolean).join('\n');
  const hasDetails =
    evidence?.command || evidence?.exitCode !== undefined || output || evidence?.evidencePath;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip {...phaseStatusMeta(criterion.status)} />
        <span className="text-xs text-foreground-passive">{verifierLabel(criterion.verifier)}</span>
      </div>
      <div className="text-sm text-foreground">{criterion.description}</div>
      {evidence?.summary ? (
        <p className="text-xs whitespace-pre-wrap text-foreground-muted">{evidence.summary}</p>
      ) : null}
      {hasDetails ? (
        <div className="grid gap-2 text-xs text-foreground-muted">
          {evidence?.command ? (
            <div className="min-w-0">
              <span className="text-foreground-passive">Command</span>
              <code className="mt-1 block truncate rounded bg-background-2 px-2 py-1 text-foreground">
                {evidence.command}
              </code>
            </div>
          ) : null}
          {evidence?.exitCode !== undefined || evidence?.durationMs !== undefined ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Exit: {evidence.exitCode ?? 'not recorded'}</span>
              {evidence.durationMs !== undefined ? <span>{evidence.durationMs}ms</span> : null}
            </div>
          ) : null}
          {output ? (
            <pre className="max-h-40 overflow-auto rounded bg-background-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-foreground-muted">
              {output}
            </pre>
          ) : null}
          {evidence?.evidencePath ? (
            <div className="min-w-0">
              <span className="text-foreground-passive">Evidence file</span>
              <code className="mt-1 block truncate rounded bg-background-2 px-2 py-1 text-foreground">
                {evidence.evidencePath}
              </code>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PhaseCard({
  loop,
  phase,
  projectId,
  taskId,
}: {
  loop: LoopWithPhases;
  phase: LoopPhase;
  projectId: string;
  taskId: string;
}) {
  const pending = loopsStore.isActionPending(loop.id);
  const criteria = phase.criteria?.criteria ?? [];
  const conversationId = phase.conversationId;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-background-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-mono text-xs text-foreground-passive">{phase.idx + 1}</span>
            <h2 className="truncate text-base font-normal text-foreground">{phase.name}</h2>
            <StatusChip {...phaseStatusMeta(phase.status)} />
          </div>
          <p className="mt-1 text-sm whitespace-pre-wrap text-foreground-muted">{phase.goal}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-foreground-passive">
            <span>Attempts: {phase.attempts}</span>
            {phase.lastError ? (
              <span className="text-foreground-destructive">{phase.lastError}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {conversationId ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void openPhaseConversation(projectId, taskId, conversationId)}
            >
              <MessageSquare className="size-3.5" />
              Thread
            </Button>
          ) : null}
          {phase.status === 'failed' ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => void loopsStore.retryPhase(loop.id, phase.id)}
            >
              <RefreshCw className="size-3.5" />
              Retry
            </Button>
          ) : null}
        </div>
      </div>

      {criteria.length > 0 ? (
        <div className="grid gap-2">
          {criteria.map((criterion, index) => (
            <EvidenceBlock
              key={`${criterion.verifier}-${index}-${criterion.description}`}
              criterion={criterion}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-border bg-background p-3 text-sm text-foreground-muted">
          No pass criteria recorded for this phase.
        </div>
      )}
    </section>
  );
}

const LoopMainPanel = observer(function LoopMainPanel() {
  const { projectId, taskId, loopId } = useLoopViewParams();
  const loop = loopsStore.getLoop(loopId);
  const loadState = loopsStore.getLoopLoadState(loopId);
  const actionError = loopsStore.getActionError(loopId);

  useEffect(() => {
    loopsStore.ensureLoopLoaded(loopId);
    loopsStore.ensureProjectLoaded(projectId);
  }, [loopId, projectId]);

  if (!loop && loadState.kind !== 'ready') {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-foreground-muted">
        {loadState.kind === 'error'
          ? (loadState.error ?? 'Failed to load loop.')
          : 'Loading loop...'}
      </div>
    );
  }

  if (!loop) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-sm text-foreground-muted">
        Loop not found.
      </div>
    );
  }

  const status = loopStatusMeta(loop.status);
  const progress = loopPhaseProgress(loop);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-8 py-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-normal text-foreground">{loop.name}</h1>
                <StatusChip {...status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-foreground-muted">
                <span>
                  Progress: {progress.passed}/{progress.total} phases
                </span>
                <span>Current phase: {loop.currentPhaseIndex + 1}</span>
              </div>
              {actionError ? (
                <p className="mt-2 text-xs text-foreground-destructive">{actionError}</p>
              ) : null}
            </div>
            <LoopControls loop={loop} />
          </header>

          <div className="grid gap-3">
            {loop.phases.map((phase) => (
              <PhaseCard
                key={phase.id}
                loop={loop}
                phase={phase}
                projectId={projectId}
                taskId={taskId}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

export const loopView = {
  WrapView: LoopViewWrapper,
  TitlebarSlot: LoopTitlebar,
  MainPanel: LoopMainPanel,
  canActivate: (params: unknown): GuardResult =>
    hasLoopViewParams(params) ? { ok: true } : { ok: false, redirect: 'home' },
} satisfies ViewDefinition<LoopViewParams>;
