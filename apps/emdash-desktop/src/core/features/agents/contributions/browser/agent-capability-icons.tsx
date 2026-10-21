import { Tooltip } from '@emdash/ui/react/primitives';
import { MessageSquare, SquareTerminal } from 'lucide-react';
import type { ReactNode } from 'react';

export function AgentCapabilityIcons({ supportsChatUi }: { supportsChatUi: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {supportsChatUi && (
        <CapabilityIcon label="Supports Chat UI">
          <MessageSquare className="size-3.5 text-foreground-passive" aria-hidden />
        </CapabilityIcon>
      )}
      <CapabilityIcon label="Supports TUI">
        <SquareTerminal className="size-3.5 text-foreground-passive" aria-hidden />
      </CapabilityIcon>
    </div>
  );
}

function CapabilityIcon({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delay={150}>
      <Tooltip.Root>
        <Tooltip.Trigger render={<span className="inline-flex" aria-label={label} />}>
          {children}
        </Tooltip.Trigger>
        <Tooltip.Content>{label}</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
