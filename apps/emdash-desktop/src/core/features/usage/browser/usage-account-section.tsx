import { SettingsCard, SettingsSection } from '@emdash/ui/react/patterns';
import { CountdownTime, Heading, Icon, Meter, Text } from '@emdash/ui/react/primitives';
import { AgentIcon } from '@core/features/agents/contributions/browser/agent-icon';
import type { UsageAccountView } from '../api/schemas';

type LimitWindow = UsageAccountView['windows'][number];
const percent = (value: number) => `${Number(value.toFixed(1))}%`;
const providerName = (id: string) => (id === 'claude' ? 'Claude' : id === 'codex' ? 'Codex' : id);
const windowName = (window: LimitWindow) => window.label.replace(/(^| · )5-hour$/, '$1Session');

export function usageAccountTitle(view: UsageAccountView): string {
  const plan = view.account.plan
    ?.trim()
    .replace(/^(?:claude|codex|chatgpt)\s+/i, '')
    .replace(/\s+subscription$/i, '')
    .replaceAll('_', ' ');
  const name = providerName(view.providerId);
  const subscription = plan ? `${name} ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : name;
  const identity = view.account.organization?.trim() || view.account.email?.trim();
  return identity ? `${subscription} (${identity})` : subscription;
}

export function UsageAccountSection({ view, title }: { view: UsageAccountView; title: string }) {
  return (
    <SettingsSection bare>
      <SettingsCard>
        <div className="space-y-5">
          <Heading level={3}>
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="flex shrink-0 items-center justify-center">
                <AgentIcon id={view.providerId} size={18} />
              </span>
              <span className="min-w-0 break-words">{title}</span>
            </span>
          </Heading>
          <div className="space-y-4">
            {view.windows.length ? (
              view.windows.map((window) => (
                <LimitRow key={window.id} window={window} title={title} />
              ))
            ) : (
              <Text as="p" tone="muted">
                {view.message ?? 'Subscription limits are unavailable.'}
              </Text>
            )}
          </div>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function LimitRow({ window, title }: { window: LimitWindow; title: string }) {
  const remaining = window.usedPercent === null ? null : 100 - window.usedPercent;
  const label = windowName(window);
  const reset =
    window.resetsAt === null ? (
      'Reset time unavailable'
    ) : (
      <span className="flex items-center gap-1 tabular-nums">
        <Icon name="rotate-cw" size="xs" />
        <CountdownTime value={window.resetsAt} expiredLabel="Reset pending" />
      </span>
    );
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <Text>{label}</Text>
        {window.stale && (
          <Text variant="caption" tone="muted">
            Stale
          </Text>
        )}
      </div>
      {remaining === null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Text tone="muted">Usage unavailable</Text>
          <Text variant="caption" tone="muted">
            {reset}
          </Text>
        </div>
      ) : (
        <Meter
          label={`${title} ${label} remaining`}
          value={remaining}
          aria-valuetext={`${percent(remaining)} left${window.stale ? ' (stale)' : ''}`}
          aria-description={
            window.resetsAt === null
              ? 'Reset time unavailable'
              : `Resets ${new Date(window.resetsAt).toLocaleString()}`
          }
          size="lg"
          color="var(--em-primary-button-background)"
          startLabel={`${percent(remaining)} left`}
          endLabel={reset}
        />
      )}
    </div>
  );
}
