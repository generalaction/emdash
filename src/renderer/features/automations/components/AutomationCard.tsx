import { motion } from 'framer-motion';
import {
  BookOpen,
  Bug,
  CircleDot,
  ClipboardList,
  Flag,
  FlaskConical,
  GitPullRequest,
  KeyRound,
  Mail,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  Siren,
  Wrench,
  Zap,
} from 'lucide-react';
import type { BuiltinAutomationTemplate } from '@shared/automations/types';

const icons = {
  BookOpen,
  Bug,
  CircleDot,
  ClipboardList,
  Flag,
  FlaskConical,
  GitPullRequest,
  KeyRound,
  Mail,
  Rocket,
  Search,
  ShieldCheck,
  Siren,
  Wrench,
  Zap,
} as const;

function Icon({ name }: { name?: string }) {
  const Component = (name && icons[name as keyof typeof icons]) || Zap;
  return <Component className="size-4" />;
}

type AutomationCardProps = {
  kind: 'template';
  template: BuiltinAutomationTemplate;
  onUse: (template: BuiltinAutomationTemplate) => void;
};

export function AutomationCard({ template, onUse }: AutomationCardProps) {
  const handleClick = () => onUse(template);
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
      className="group flex min-h-28 w-full cursor-pointer flex-col rounded-xl border border-border bg-muted/20 p-4 text-left text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
          <Icon name={template.icon} />
        </div>
        <Plus className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {template.name}
      </h3>
      <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
        {template.description}
      </p>
    </motion.div>
  );
}
