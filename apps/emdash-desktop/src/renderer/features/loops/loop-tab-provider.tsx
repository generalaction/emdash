import { Pause, Play, RefreshCw, Repeat2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { getAppSettingValueSnapshot } from '@renderer/features/settings/app-settings-client';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import type {
  ResolvedTab,
  TabBarItemProps,
  TabContentProps,
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
} from '@renderer/features/tabs/core/tab-provider';
import { createTabProvider } from '@renderer/features/tabs/core/tab-provider-registry';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@renderer/features/tabs/tab-bar/generic-tab-item';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type {
  LoopAuthoringPort,
  LoopTabBrowserState,
  LoopTabPhaseSnapshot,
} from './loop-authoring-port';
import { loopStatusMeta, phaseStatusMeta, statusToneClass, type StatusTone } from './loop-format';
import { LoopTabResource } from './loop-tab-resource';

export interface LoopTabState {
  loopId: string;
}

export interface LoopTabOpenArgs {
  loopId: string;
}

function StatusChip({ label, tone }: { label: string; tone: StatusTone }) {
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

function phaseKindLabel(kind: LoopTabPhaseSnapshot['kind']): string {
  switch (kind) {
    case 'work':
      return 'Work';
    case 'review':
      return 'Review';
    case 'e2e':
      return 'E2E';
  }
}

function browserMeta(browser: LoopTabBrowserState): { label: string; tone: StatusTone } {
  switch (browser.kind) {
    case 'disabled':
      return { label: 'Browser disabled', tone: 'neutral' };
    case 'waiting':
      return { label: 'Waiting for preview', tone: 'neutral' };
    case 'ready':
      return { label: 'Browser ready', tone: 'info' };
    case 'running':
      return { label: 'Browser running', tone: 'info' };
    case 'reconnecting':
      return { label: 'Browser reconnecting', tone: 'warning' };
    case 'passed':
      return { label: 'Browser passed', tone: 'success' };
    case 'failed':
      return { label: 'Browser failed', tone: 'danger' };
  }
}

function BrowserState({ browser }: { browser: LoopTabBrowserState }) {
  const meta = browserMeta(browser);
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-3"
    >
      <StatusChip {...meta} />
      {browser.kind !== 'disabled' ? (
        <span className="text-sm text-foreground-muted">{browser.message}</span>
      ) : null}
    </div>
  );
}

function HandoffBlock({ phase }: { phase: LoopTabPhaseSnapshot }) {
  const handoff = phase.handoff;
  if (!handoff) return null;

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background p-3">
      <h3 className="text-xs font-medium tracking-wide text-foreground-passive uppercase">
        Handoff
      </h3>
      <p className="text-sm whitespace-pre-wrap text-foreground-muted">{handoff.summary}</p>
      {handoff.risks.length > 0 ? (
        <div>
          <div className="text-xs text-foreground-passive">Risks</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
            {handoff.risks.map((risk) => (
              <li key={risk}>{risk}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {handoff.remainingWork.length > 0 ? (
        <div>
          <div className="text-xs text-foreground-passive">Remaining work</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground-muted">
            {handoff.remainingWork.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {handoff.artifacts.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {handoff.artifacts.map((artifact) => (
            <span
              key={artifact.artifactId}
              className="rounded border border-border bg-background-2 px-2 py-1 text-xs text-foreground-muted"
            >
              {artifact.label ?? artifact.kind} · {artifact.byteLength} bytes
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EvidenceBlock({ phase }: { phase: LoopTabPhaseSnapshot }) {
  if (phase.evidence.length === 0) return null;
  return (
    <div className="grid gap-2" aria-label={`${phase.name} evidence`}>
      {phase.evidence.map((evidence, index) => (
        <div
          key={`${evidence.label}-${index}`}
          className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-background p-3"
        >
          <StatusChip {...phaseStatusMeta(evidence.status)} />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-foreground">{evidence.label}</div>
            <p className="mt-1 text-xs whitespace-pre-wrap text-foreground-muted">
              {evidence.summary}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function PhaseCard({
  phase,
  resource,
}: {
  phase: LoopTabPhaseSnapshot;
  resource: LoopTabResource;
}) {
  const meta = phaseStatusMeta(phase.status);
  const pending = resource.action.kind === 'pending';
  return (
    <article className="grid gap-3 rounded-lg border border-border bg-background-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-foreground-passive">{phase.index + 1}</span>
            <span className="rounded bg-background-2 px-1.5 py-0.5 text-xs text-foreground-muted">
              {phaseKindLabel(phase.kind)}
            </span>
            <h2 className="text-base font-normal text-foreground">{phase.name}</h2>
            <StatusChip {...meta} />
          </div>
          <p className="mt-1 text-sm whitespace-pre-wrap text-foreground-muted">{phase.goal}</p>
          <div className="mt-2 text-xs text-foreground-passive">Attempts: {phase.attempts}</div>
        </div>
        {phase.status === 'failed' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`Retry ${phase.name}`}
            aria-busy={pending}
            disabled={pending}
            onClick={() => void resource.retryPhase(phase.id)}
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        ) : null}
      </div>
      {phase.lastError ? (
        <div role="alert" className="text-sm text-foreground-destructive">
          {phase.lastError}
        </div>
      ) : null}
      <HandoffBlock phase={phase} />
      <EvidenceBlock phase={phase} />
    </article>
  );
}

export const LoopTabPanel = observer(function LoopTabPanel({
  resource,
}: {
  resource: LoopTabResource;
}) {
  if (resource.state.kind === 'idle' || resource.state.kind === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-full items-center justify-center bg-background text-sm text-foreground-muted"
      >
        Loading Loop…
      </div>
    );
  }

  if (resource.state.kind === 'error') {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-sm text-foreground-destructive">{resource.state.message}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-label="Retry loading Loop"
            onClick={() => void resource.load()}
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const snapshot = resource.state.snapshot;
  const loopMeta = loopStatusMeta(snapshot.status);
  const pending = resource.action.kind === 'pending';
  const phases = [...snapshot.phases].sort((a, b) => a.index - b.index);

  return (
    <section
      aria-label={snapshot.name}
      className="h-full min-h-0 overflow-y-auto bg-background text-foreground"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-8 py-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-normal text-foreground">{snapshot.name}</h1>
              <StatusChip {...loopMeta} />
            </div>
            <p className="mt-2 text-sm text-foreground-muted">
              Phase {Math.min(snapshot.currentPhaseIndex + 1, Math.max(phases.length, 1))} of{' '}
              {phases.length}
            </p>
          </div>
          {snapshot.status === 'draft' || snapshot.status === 'failed' ? (
            <Button
              type="button"
              size="sm"
              aria-label={snapshot.status === 'failed' ? 'Restart Loop' : 'Start Loop'}
              aria-busy={pending}
              disabled={pending}
              onClick={() => void resource.start()}
            >
              <Play className="size-3.5" />
              {snapshot.status === 'failed' ? 'Restart Loop' : 'Start Loop'}
            </Button>
          ) : null}
          {snapshot.status === 'running' ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Pause Loop"
              aria-busy={pending}
              disabled={pending}
              onClick={() => void resource.pause()}
            >
              <Pause className="size-3.5" />
              Pause
            </Button>
          ) : null}
          {snapshot.status === 'paused' ? (
            <Button
              type="button"
              size="sm"
              aria-label="Resume Loop"
              aria-busy={pending}
              disabled={pending}
              onClick={() => void resource.resume()}
            >
              <Play className="size-3.5" />
              Resume
            </Button>
          ) : null}
        </header>

        {resource.action.kind === 'error' ? (
          <div
            role="alert"
            className="rounded-md bg-background-destructive p-3 text-sm text-foreground-destructive"
          >
            {resource.action.message}
          </div>
        ) : null}

        <BrowserState browser={snapshot.browser} />
        <div className="grid gap-3">
          {phases.map((phase) => (
            <PhaseCard key={phase.id} phase={phase} resource={resource} />
          ))}
        </div>
      </div>
    </section>
  );
});

const LoopTabBarItem = observer(function LoopTabBarItem({
  tab,
  host,
  ctx,
}: TabBarItemProps<LoopTabResource>) {
  const { value, isLoading } = useAppSettingsKey('experiments');
  if (isLoading || !value?.loops) return null;
  const label = tab.resource.state.kind === 'ready' ? tab.resource.state.snapshot.name : 'Loop';
  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label={label}
      preSlot={<Repeat2 className="size-4" />}
    />
  );
});

function LoopTabBarItemDragPreview({ tab }: { tab: ResolvedTab<LoopTabResource> }) {
  if (getAppSettingValueSnapshot('experiments')?.loops !== true) return null;
  const label = tab.resource.state.kind === 'ready' ? tab.resource.state.snapshot.name : 'Loop';
  return <GenericTabDragPreview preSlot={<Repeat2 className="size-4" />} label={label} />;
}

const LoopTabContent = observer(function LoopTabContent({ host }: TabContentProps) {
  const { value, isLoading } = useAppSettingsKey('experiments');
  const activeTab = host.resolvedTabs.find((tab) => tab.isActive);
  const resource = activeTab?.kind === 'loop' ? (activeTab.resource as LoopTabResource) : undefined;
  const enabled = !isLoading && value?.loops === true;
  useEffect(() => resource?.setEnabled(enabled), [enabled, resource]);
  if (activeTab?.kind !== 'loop') return null;
  if (!enabled || !resource) return null;
  return <LoopTabPanel resource={resource} />;
});

export function createLoopTabProvider(
  port: LoopAuthoringPort
): TabProvider<'loop', LoopTabState, LoopTabResource, LoopTabOpenArgs> {
  return createTabProvider({
    kind: 'loop',
    mount: 'single',
    resourceKey: (state: LoopTabState) => state.loopId,
    onBeforeOpen(args: LoopTabOpenArgs): LoopTabState | null {
      if (getAppSettingValueSnapshot('experiments')?.loops !== true) return null;
      const loopId = args.loopId.trim();
      return loopId ? { loopId } : null;
    },
    initialize(
      entry: TabEntry<LoopTabState>,
      _handle: TabHandle,
      _ctx: TabViewContext
    ): LoopTabResource {
      return new LoopTabResource(entry.state.loopId, port);
    },
    dispose(_entry: TabEntry<LoopTabState>, resource: LoopTabResource): void {
      resource.dispose();
    },
    TabBarItem: LoopTabBarItem,
    TabBarItemDragPreview: LoopTabBarItemDragPreview,
    TabContent: LoopTabContent,
  });
}
