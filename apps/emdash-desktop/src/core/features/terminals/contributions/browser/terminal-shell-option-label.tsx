import type { TerminalShellAvailability } from '@emdash/core/primitives/terminal-shell/api';
import { Devicon } from '@emdash/ui/react/components';
import { Badge, Icon } from '@emdash/ui/react/primitives';
import { Terminal } from 'lucide-react';
import fishIcon from '@/assets/images/shells/fish.svg?raw';
import { shellGraphicAdapter } from './shell-graphic.adapter.css';
const SHELL_DEVICON_CLASS: Partial<Record<string, string>> = {
  bash: 'devicon-bash-plain',
  cmd: 'devicon-windows11-plain',
  powershell: 'devicon-powershell-plain',
  pwsh: 'devicon-powershell-plain',
  wsl: 'devicon-linux-plain',
  zsh: 'devicon-zsh-plain',
};

const SHELL_SVG_ICON: Partial<Record<string, string>> = {
  fish: fishIcon,
};

function TerminalShellIcon({ shell }: { shell: string }) {
  const shellKey = shell.toLowerCase();
  const svgIcon = SHELL_SVG_ICON[shellKey];
  if (svgIcon) {
    return (
      <span
        className={shellGraphicAdapter}
        data-foreign-adapter="shell-graphic"
        dangerouslySetInnerHTML={{ __html: svgIcon }}
        aria-hidden="true"
      />
    );
  }

  const deviconClass = SHELL_DEVICON_CLASS[shellKey];
  if (deviconClass) {
    return <Devicon iconClass={deviconClass} size={16} className="text-foreground-muted" />;
  }

  return <Icon source={Terminal} size="md" className="text-foreground-muted" />;
}

export function TerminalShellOptionLabel({
  entry,
  showSystemBadge = true,
}: {
  entry: TerminalShellAvailability;
  showSystemBadge?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <TerminalShellIcon shell={entry.id === 'system' ? entry.label : entry.id} />
      <span className="truncate">{entry.label}</span>
      {showSystemBadge && entry.isSystemDefault ? <Badge>system</Badge> : null}
    </span>
  );
}
