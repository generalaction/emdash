import { SettingsCard, SettingsSection } from '@emdash/ui/react/patterns';
import {
  AbsoluteTime,
  CountdownTime,
  Icon,
  Meter,
  Popover,
  RelativeTime,
  Separator,
} from '@emdash/ui/react/primitives';
import type { ReactNode } from 'react';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import type { UsageAccountView } from '../api/schemas';

type LimitWindow = UsageAccountView['windows'][number];
const percent = (value: number) => `${Number(value.toFixed(1))}%`;
const providerName = (id: string) => (id === 'claude' ? 'Claude' : id === 'codex' ? 'Codex' : id);
const windowName = (window: LimitWindow) => window.label.replace(/(^| · )5-hour$/, '$1Session');

export function UsageAccountSection({ view, number }: { view: UsageAccountView; number: number }) {
  const name = providerName(view.providerId);
  const title = number === 1 ? name : `${name} (${number})`;
  return (
    <SettingsSection
      bare
      title={
        <span className="flex items-center gap-2.5 text-base font-medium">
          <span aria-hidden="true">
            <AgentIcon id={view.providerId} size={20} />
          </span>
          {title}
        </span>
      }
    >
      <div className="space-y-3">
        {view.windows.length ? (
          view.windows.map((window) => (
            <LimitRow key={window.id} view={view} window={window} title={title} />
          ))
        ) : (
          <SettingsCard>
            <p className="text-sm text-foreground-muted">
              {view.message ?? 'Subscription limits are unavailable.'}
            </p>
          </SettingsCard>
        )}
      </div>
    </SettingsSection>
  );
}

function LimitRow({
  view,
  window,
  title,
}: {
  view: UsageAccountView;
  window: LimitWindow;
  title: string;
}) {
  const remaining = window.usedPercent === null ? null : 100 - window.usedPercent;
  const label = windowName(window);
  const name = providerName(view.providerId);
  return (
    <SettingsCard>
      <div className="grid items-center gap-5 py-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            {label}
            {window.stale && (
              <span className="text-xs font-normal text-foreground-muted">Stale</span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl leading-none font-semibold tracking-tight tabular-nums">
              {remaining === null ? '—' : percent(remaining)}
            </span>
            <span className="text-sm text-foreground-muted">
              {remaining === null ? 'unknown' : 'left'}
            </span>
          </div>
          <p className="flex items-center gap-1 text-xs text-foreground-muted tabular-nums">
            <Icon name="rotate-cw" size="xs" />
            {window.resetsAt === null ? (
              'Reset time unavailable'
            ) : (
              <CountdownTime
                value={window.resetsAt}
                prefix={
                  window.usedPercent === null ? 'Resets in ' : `+${percent(window.usedPercent)} in `
                }
                expiredLabel="Reset pending"
              />
            )}
          </p>
        </div>
        <Popover.Root>
          <Popover.Trigger
            openOnHover
            delay={150}
            closeDelay={150}
            nativeButton={false}
            render={<div />}
            className="w-full min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-foreground-info"
            aria-label={`${title} ${label}: ${remaining === null ? 'usage unknown' : `${percent(remaining)} left`}. Account details`}
          >
            {remaining === null ? (
              <span className="block py-3 text-sm text-foreground-muted">Usage unavailable</span>
            ) : (
              <Meter
                label={`${title} ${label} remaining`}
                value={remaining}
                aria-valuetext={`${percent(remaining)} left`}
                size="lg"
                striped
                color={view.providerId === 'claude' ? '#D97757' : 'var(--em-foreground)'}
                startLabel={`${name} ${percent(remaining)}`}
                endLabel={
                  window.resetsAt === null ? undefined : (
                    <span className="flex items-center gap-1 tabular-nums">
                      <Icon name="rotate-cw" size="xs" />
                      <CountdownTime value={window.resetsAt} expiredLabel="Pending" />
                    </span>
                  )
                }
              />
            )}
          </Popover.Trigger>
          <Popover.Content side="top" sideOffset={8} className="w-80 max-w-[calc(100vw-2rem)]">
            <AccountDetails view={view} window={window} title={title} />
          </Popover.Content>
        </Popover.Root>
      </div>
    </SettingsCard>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-sm">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function AccountDetails({
  view,
  window,
  title,
}: {
  view: UsageAccountView;
  window: LimitWindow;
  title: string;
}) {
  const remaining = window.usedPercent === null ? null : 100 - window.usedPercent;
  return (
    <>
      <Popover.Header>
        <Popover.Title>
          <span className="flex items-center gap-2 text-base font-medium">
            <span aria-hidden="true">
              <AgentIcon id={view.providerId} size={20} />
            </span>
            {title}
          </span>
        </Popover.Title>
        <Popover.Description className="break-all">
          {view.account.email ?? 'Account identity unavailable'}
        </Popover.Description>
      </Popover.Header>
      <Separator />
      <dl className="space-y-1.5">
        {view.account.plan && <Detail label="Plan">{view.account.plan}</Detail>}
        {view.account.organization && (
          <Detail label="Workspace">{view.account.organization}</Detail>
        )}
        <Detail label="Signed in">
          {view.sources
            .map(
              (source) =>
                `${source.machineName}${source.status === 'disconnected' ? ' (offline)' : ''}`
            )
            .join(', ')}
        </Detail>
      </dl>
      <Separator />
      <dl className="space-y-1.5">
        <Detail label="Left">{remaining === null ? 'Unknown' : percent(remaining)}</Detail>
        <Detail label="Resets">
          {window.resetsAt === null ? (
            'Unknown'
          ) : (
            <>
              <AbsoluteTime value={window.resetsAt} /> ·{' '}
              <CountdownTime value={window.resetsAt} prefix="in " expiredLabel="Reset pending" />
            </>
          )}
        </Detail>
        {window.usedPercent !== null && window.resetsAt !== null && (
          <Detail label="Restores">+{percent(window.usedPercent)} of allowance</Detail>
        )}
      </dl>
      {window.stale && (
        <p className="text-xs text-foreground-muted">
          Last read <RelativeTime value={window.observedAt} /> on {window.sourceName}. Refresh for
          current limits.
        </p>
      )}
    </>
  );
}
