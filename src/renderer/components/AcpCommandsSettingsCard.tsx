import React from 'react';
import { Home, FolderOpen } from 'lucide-react';
import OpenInMenu from './titlebar/OpenInMenu';

const GLOBAL_COMMANDS_PATH = '~/.codex/commands';

const AcpCommandsSettingsCard: React.FC = () => {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <p className="mb-3 text-sm text-muted-foreground">
        Create reusable slash prompts by adding files to these folders:
      </p>

      <div className="space-y-2">
        {/* Global commands */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Home className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs">
                ~/.codex/commands
              </code>
              <span className="text-muted-foreground">or</span>
              <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs">
                ~/.codex/prompts
              </code>
            </div>
          </div>
          <OpenInMenu path={GLOBAL_COMMANDS_PATH} ensureDir={true} />
        </div>

        {/* Project commands */}
        <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <FolderOpen className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex flex-wrap items-center gap-1.5">
              <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs">
                .codex/commands
              </code>
              <span className="text-muted-foreground">or</span>
              <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs">
                .codex/prompts
              </code>
              <span className="text-xs text-muted-foreground/70">(repo root)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AcpCommandsSettingsCard;
