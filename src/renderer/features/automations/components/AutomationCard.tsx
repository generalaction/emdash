import { motion } from 'framer-motion';
import {
  CircleDot,
  ClipboardList,
  GitPullRequest,
  History,
  Pencil,
  Play,
  Plus,
  Rocket,
  Siren,
  Trash2,
  Zap,
} from 'lucide-react';
import { formatTriggerLabel } from '@shared/automations/format';
import type { Automation, BuiltinAutomationTemplate, TriggerSpec } from '@shared/automations/types';
import { Switch } from '@renderer/lib/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

const icons = {
  CircleDot,
  ClipboardList,
  GitPullRequest,
  Rocket,
  Siren,
  Zap,
} as const;

function Icon({ name }: { name?: string }) {
  const Component = name && name in icons ? icons[name as keyof typeof icons] : Zap;
  return <Component className="size-4" />;
}

function getTrigger(item: Automation | BuiltinAutomationTemplate): TriggerSpec {
  return 'trigger' in item ? item.trigger : item.defaultTrigger;
}

type AutomationCardProps =
  | {
      kind: 'template';
      template: BuiltinAutomationTemplate;
      onUse: (template: BuiltinAutomationTemplate) => void;
    }
  | {
      kind: 'automation';
      automation: Automation;
      onEdit: (automation: Automation) => void;
      onDelete: (automation: Automation) => void;
      onRunNow: (automation: Automation) => void;
      onSetEnabled: (automation: Automation, enabled: boolean) => void;
      onShowRuns: (automation: Automation) => void;
      busy?: boolean;
    };

export function AutomationCard(props: AutomationCardProps) {
  const item = props.kind === 'template' ? props.template : props.automation;
  const trigger = getTrigger(item);
  const triggerLabel = formatTriggerLabel(trigger);

  const handleClick = () => {
    if (props.kind === 'template') props.onUse(props.template);
    else props.onEdit(props.automation);
  };

  return (
    <motion.div
      role="button"
      tabIndex={0}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.1, ease: 'easeInOut' }}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-muted/20 p-4 text-left text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
        <Icon name={props.kind === 'template' ? props.template.icon : undefined} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold">{item.name}</h3>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {triggerLabel}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
      </div>

      {props.kind === 'template' ? (
        <div className="shrink-0 self-center">
          <Plus className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      ) : (
        <AutomationCardActions
          automation={props.automation}
          busy={props.busy}
          onRunNow={props.onRunNow}
          onShowRuns={props.onShowRuns}
          onDelete={props.onDelete}
          onSetEnabled={props.onSetEnabled}
        />
      )}
    </motion.div>
  );
}

function AutomationCardActions({
  automation,
  busy,
  onRunNow,
  onShowRuns,
  onDelete,
  onSetEnabled,
}: {
  automation: Automation;
  busy?: boolean;
  onRunNow: (automation: Automation) => void;
  onShowRuns: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onSetEnabled: (automation: Automation, enabled: boolean) => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1 self-center"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={() => onRunNow(automation)}
            disabled={busy}
            aria-label="Run now"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Play className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Run now</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={() => onShowRuns(automation)}
            aria-label="Run history"
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100"
          >
            <History className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Run history</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            onClick={() => onDelete(automation)}
            aria-label="Delete"
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-destructive group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Delete</TooltipContent>
      </Tooltip>
      <Switch
        checked={automation.enabled}
        onCheckedChange={(enabled) => onSetEnabled(automation, enabled)}
        aria-label={automation.enabled ? 'Disable automation' : 'Enable automation'}
        className="ml-1"
      />
      <Pencil className="ml-1 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}
