import { Button } from '@emdash/ui/react/primitives';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudOff,
  Loader2,
  ServerCog,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';

/**
 * PROTOTYPE — throwaway.
 * Three variants of degraded Project availability on the existing Project route,
 * switchable with ?projectAvailabilityVariant= and ?projectAvailabilityScenario=.
 */

type PrototypeVariant = 'banner' | 'scrim' | 'rail';
type PrototypeScenario =
  | 'offline'
  | 'connecting'
  | 'preparing'
  | 'attached'
  | 'failed'
  | 'disconnected';

type ScenarioDefinition = {
  label: string;
  title: string;
  detail: string;
  action?: string;
  next?: PrototypeScenario;
  tone: 'neutral' | 'warning' | 'success' | 'danger';
  icon: typeof CloudOff;
};

const variants: Array<{ id: PrototypeVariant; label: string }> = [
  { id: 'banner', label: 'Global banner' },
  { id: 'scrim', label: 'Panel-local status' },
  { id: 'rail', label: 'Persistent status rail' },
];

const scenarioOrder: PrototypeScenario[] = [
  'offline',
  'connecting',
  'preparing',
  'attached',
  'failed',
  'disconnected',
];

const scenarios: Record<PrototypeScenario, ScenarioDefinition> = {
  offline: {
    label: 'Cold boot offline',
    title: 'Orion is offline',
    detail: 'Tasks, settings, and previously observed data remain available.',
    action: 'Connect',
    next: 'connecting',
    tone: 'warning',
    icon: CloudOff,
  },
  connecting: {
    label: 'Connecting',
    title: 'Connecting to Orion',
    detail: 'The Project stays open while the SSH connection is established.',
    tone: 'neutral',
    icon: Loader2,
  },
  preparing: {
    label: 'Preparing Host',
    title: 'Preparing Orion',
    detail: 'SSH is connected. The workspace server is starting.',
    tone: 'neutral',
    icon: ServerCog,
  },
  attached: {
    label: 'Attached',
    title: 'Orion is ready',
    detail: 'Host-dependent data and actions are available.',
    tone: 'success',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Attachment failed',
    title: 'Orion needs attention',
    detail: 'The workspace server could not be prepared. Project data remains available.',
    action: 'Retry',
    next: 'preparing',
    tone: 'danger',
    icon: TriangleAlert,
  },
  disconnected: {
    label: 'Disconnected later',
    title: 'Orion went offline',
    detail: 'This Project remains open and will resume when Orion reconnects.',
    action: 'Reconnect',
    next: 'connecting',
    tone: 'warning',
    icon: CloudOff,
  },
};

const toneClasses: Record<ScenarioDefinition['tone'], string> = {
  neutral: 'border-border bg-background-1 text-foreground',
  warning: 'border-foreground-warning/30 bg-background-warning text-foreground',
  success: 'border-foreground-success/30 bg-background-success text-foreground',
  danger: 'border-foreground-destructive/30 bg-background-destructive text-foreground',
};

const iconClasses: Record<ScenarioDefinition['tone'], string> = {
  neutral: 'text-foreground-muted',
  warning: 'text-foreground-warning',
  success: 'text-foreground-success',
  danger: 'text-foreground-destructive',
};

function parseVariant(value: string | null): PrototypeVariant {
  return variants.some((variant) => variant.id === value) ? (value as PrototypeVariant) : 'banner';
}

function parseScenario(value: string | null): PrototypeScenario {
  return scenarioOrder.includes(value as PrototypeScenario)
    ? (value as PrototypeScenario)
    : 'offline';
}

function initialPrototypeState(): {
  variant: PrototypeVariant;
  scenario: PrototypeScenario;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    variant: parseVariant(params.get('projectAvailabilityVariant')),
    scenario: parseScenario(params.get('projectAvailabilityScenario')),
  };
}

function replacePrototypeParams(variant: PrototypeVariant, scenario: PrototypeScenario): void {
  const url = new URL(window.location.href);
  url.searchParams.set('projectAvailabilityVariant', variant);
  url.searchParams.set('projectAvailabilityScenario', scenario);
  window.history.replaceState(window.history.state, '', url);
}

function nextInOrder<T>(values: readonly T[], current: T, direction: -1 | 1): T {
  const index = values.indexOf(current);
  return values[(index + direction + values.length) % values.length] ?? current;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function ProjectAvailabilityPrototype({ children }: { children: ReactNode }) {
  const initial = initialPrototypeState();
  const [variant, setVariant] = useState<PrototypeVariant>(initial.variant);
  const [scenario, setScenario] = useState<PrototypeScenario>(initial.scenario);

  const updateVariant = (nextVariant: PrototypeVariant) => {
    setVariant(nextVariant);
    replacePrototypeParams(nextVariant, scenario);
  };

  const updateScenario = (nextScenario: PrototypeScenario) => {
    setScenario(nextScenario);
    replacePrototypeParams(variant, nextScenario);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        updateVariant(
          nextInOrder(
            variants.map((candidate) => candidate.id),
            variant,
            event.key === 'ArrowLeft' ? -1 : 1
          )
        );
      }

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        updateScenario(nextInOrder(scenarioOrder, scenario, event.key === 'ArrowUp' ? -1 : 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scenario, variant]);

  const definition = scenarios[scenario];
  const action = definition.next ? (
    <Button
      type="button"
      variant={definition.tone === 'danger' ? 'primary' : 'secondary'}
      size="sm"
      onClick={() => updateScenario(definition.next!)}
    >
      {definition.action}
    </Button>
  ) : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        {variant === 'banner' && (
          <BannerVariant definition={definition} action={action}>
            {children}
          </BannerVariant>
        )}
        {variant === 'scrim' && (
          <ScrimVariant definition={definition} action={action}>
            {children}
          </ScrimVariant>
        )}
        {variant === 'rail' && (
          <RailVariant definition={definition} scenario={scenario} action={action}>
            {children}
          </RailVariant>
        )}
      </div>
      <PrototypeSwitcher
        variant={variant}
        scenario={scenario}
        onVariantChange={updateVariant}
        onScenarioChange={updateScenario}
      />
    </div>
  );
}

function BannerVariant({
  children,
  definition,
  action,
}: {
  children: ReactNode;
  definition: ScenarioDefinition;
  action: ReactNode;
}) {
  const Icon = definition.icon;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <section
        role="status"
        aria-live="polite"
        className={cn(
          'mt-6 flex shrink-0 items-center gap-3 rounded-lg border px-4 py-3',
          toneClasses[definition.tone]
        )}
      >
        <Icon
          className={cn(
            'size-4 shrink-0',
            definition.icon === Loader2 && 'animate-spin',
            iconClasses[definition.tone]
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{definition.title}</p>
          <p className="truncate text-xs text-foreground-muted">{definition.detail}</p>
        </div>
        {action}
      </section>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function ScrimVariant({
  children,
  definition,
  action,
}: {
  children: ReactNode;
  definition: ScenarioDefinition;
  action: ReactNode;
}) {
  const Icon = definition.icon;
  return (
    <div className="relative h-full min-h-0">
      <div className="h-full min-h-0 opacity-45">{children}</div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8">
        <section
          role="status"
          aria-live="polite"
          className={cn(
            'pointer-events-auto flex max-w-sm flex-col items-center gap-3 rounded-xl border p-6 text-center',
            toneClasses[definition.tone]
          )}
        >
          <Icon
            className={cn(
              'size-6',
              definition.icon === Loader2 && 'animate-spin',
              iconClasses[definition.tone]
            )}
          />
          <div>
            <p className="text-sm font-medium">{definition.title}</p>
            <p className="mt-1 text-xs leading-5 text-foreground-muted">{definition.detail}</p>
          </div>
          {action}
          <p className="text-[11px] text-foreground-passive">
            Host-dependent actions pause here; desktop data remains behind this panel.
          </p>
        </section>
      </div>
    </div>
  );
}

function RailVariant({
  children,
  definition,
  scenario,
  action,
}: {
  children: ReactNode;
  definition: ScenarioDefinition;
  scenario: PrototypeScenario;
  action: ReactNode;
}) {
  const Icon = definition.icon;
  const activeIndex = scenarioOrder.indexOf(scenario);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_12rem] gap-5">
      <div className="min-h-0">{children}</div>
      <aside className="my-10 flex min-h-0 flex-col rounded-lg border border-border bg-background-1 p-4">
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              'size-4 shrink-0',
              definition.icon === Loader2 && 'animate-spin',
              iconClasses[definition.tone]
            )}
          />
          <p className="text-xs font-medium">{definition.title}</p>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-foreground-muted">{definition.detail}</p>
        <div className="my-4 h-px bg-border" />
        <ol className="flex flex-col gap-3" aria-label="Host attachment progress">
          {['SSH connection', 'Workspace server', 'Project attachment'].map((label, index) => {
            const stepIndex = Math.min(activeIndex, 3);
            const complete = scenario === 'attached' || index < stepIndex;
            const active = scenario !== 'failed' && index === stepIndex;
            return (
              <li key={label} className="flex items-center gap-2 text-[11px]">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full border border-border',
                    complete && 'border-foreground-success bg-foreground-success',
                    active && 'border-foreground bg-foreground'
                  )}
                />
                <span
                  className={complete || active ? 'text-foreground' : 'text-foreground-passive'}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
        {action && <div className="mt-auto pt-4">{action}</div>}
      </aside>
    </div>
  );
}

function PrototypeSwitcher({
  variant,
  scenario,
  onVariantChange,
  onScenarioChange,
}: {
  variant: PrototypeVariant;
  scenario: PrototypeScenario;
  onVariantChange: (variant: PrototypeVariant) => void;
  onScenarioChange: (scenario: PrototypeScenario) => void;
}) {
  const variantDefinition = variants.find((candidate) => candidate.id === variant)!;

  return (
    <div className="fixed bottom-4 left-1/2 z-100 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-foreground px-2 py-1.5 text-background">
      <span className="px-1 text-[10px] font-medium tracking-wide uppercase">Prototype</span>
      <div className="h-5 w-px bg-background/25" />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        icon
        aria-label="Previous prototype variant"
        onClick={() =>
          onVariantChange(
            nextInOrder(
              variants.map((candidate) => candidate.id),
              variant,
              -1
            )
          )
        }
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <span className="min-w-36 text-center text-xs">
        {variant.toUpperCase()} — {variantDefinition.label}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        icon
        aria-label="Next prototype variant"
        onClick={() =>
          onVariantChange(
            nextInOrder(
              variants.map((candidate) => candidate.id),
              variant,
              1
            )
          )
        }
      >
        <ChevronRight className="size-3.5" />
      </Button>
      <div className="h-5 w-px bg-background/25" />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        icon
        aria-label="Previous Host scenario"
        onClick={() => onScenarioChange(nextInOrder(scenarioOrder, scenario, -1))}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <span className="min-w-31 text-center text-xs">{scenarios[scenario].label}</span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        icon
        aria-label="Next Host scenario"
        onClick={() => onScenarioChange(nextInOrder(scenarioOrder, scenario, 1))}
      >
        <ChevronDown className="size-3.5" />
      </Button>
    </div>
  );
}
