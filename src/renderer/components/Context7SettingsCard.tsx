import React from 'react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { CONTEXT7_INTEGRATION } from '../mcp/context7';
import FeedbackModal from './FeedbackModal';
import context7Logo from '../../assets/images/context7.png';

const Context7SettingsCard: React.FC = () => {
  const [enabled, setEnabled] = React.useState<boolean>(false);
  const [busy, setBusy] = React.useState<boolean>(false);
  const [showMcpFeedback, setShowMcpFeedback] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res?.success && res.settings) {
        const flag = Boolean(res.settings.mcp?.context7?.enabled);
        setEnabled(flag);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggle = async (next: boolean) => {
    setBusy(true);
    try {
      await window.electronAPI.updateSettings({ mcp: { context7: { enabled: next } } as any });
      setEnabled(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2 p-2">
        <img
          src={context7Logo}
          alt="Context7"
          className="h-5 w-5 flex-shrink-0 rounded object-contain"
        />
        <div className="flex flex-1 items-center gap-1.5">
          <p className="text-sm font-medium text-foreground">Context7</p>
          <p className="text-sm text-foreground/50">
            Enable Context7 MCP to enrich prompts with up‑to‑date library docs.
          </p>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex-shrink-0 text-foreground/50 transition-colors hover:text-foreground"
                  aria-label="More information"
                >
                  <Info className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="space-y-2 text-xs">
                  <p>
                    You must configure Context7 MCP in your coding agent (Codex, Claude Code,
                    Cursor, etc.) before using it in Emdash.
                  </p>
                  <p>
                    After setup, enabling Context7 here lets Emdash invoke it in your terminal
                    sessions so agents can fetch up‑to‑date docs when needed.
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs underline-offset-2 hover:underline"
                      onClick={() =>
                        window.electronAPI.openExternal(CONTEXT7_INTEGRATION.docsUrl)
                      }
                    >
                      Docs ↗
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs underline-offset-2 hover:underline"
                      onClick={() => setShowMcpFeedback(true)}
                    >
                      Suggest an MCP ↗
                    </Button>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={busy}
          aria-label="Enable Context7 MCP"
        />
      </div>

      {showMcpFeedback ? (
        <FeedbackModal
          isOpen={showMcpFeedback}
          onClose={() => setShowMcpFeedback(false)}
          blurb="Which MCP would you like Emdash to support next? Include the MCP name, link, and why it helps your workflow."
        />
      ) : null}
    </>
  );
};

export default Context7SettingsCard;
