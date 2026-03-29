import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { useFeatureFlag } from '../hooks/useFeatureFlag';

type LifecycleScripts = {
  setup: string;
  run: string;
  stop: string;
  teardown: string;
};

type WorkspaceProviderConfig = {
  type: 'script';
  provisionCommand: string;
  terminateCommand: string;
};

type CiAutoFixConfig = {
  enabled?: boolean;
  mode?: 'auto' | 'review';
  checkFilters?: {
    include?: string[];
    exclude?: string[];
  };
};

type ConfigShape = Record<string, unknown> & {
  preservePatterns?: string[];
  scripts?: Partial<LifecycleScripts>;
  shellSetup?: string;
  tmux?: boolean;
  workspaceProvider?: WorkspaceProviderConfig;
  ciAutoFix?: CiAutoFixConfig;
};

interface ConfigEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
  isRemote?: boolean;
  sshConnectionId?: string | null;
}

const EMPTY_SCRIPTS: LifecycleScripts = {
  setup: '',
  run: '',
  stop: '',
  teardown: '',
};
const PROJECT_CONFIG_DOCS_URL = 'https://docs.emdash.sh/project-config';

function ensureConfigObject(raw: unknown): ConfigShape {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ConfigShape) : {};
}

function scriptsFromConfig(config: ConfigShape): LifecycleScripts {
  const scripts = config.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return { ...EMPTY_SCRIPTS };
  }

  const obj = scripts as Record<string, unknown>;
  return {
    setup: typeof obj.setup === 'string' ? obj.setup : '',
    run: typeof obj.run === 'string' ? obj.run : '',
    stop: typeof obj.stop === 'string' ? obj.stop : '',
    teardown: typeof obj.teardown === 'string' ? obj.teardown : '',
  };
}

function applyScripts(config: ConfigShape, scripts: LifecycleScripts): ConfigShape {
  const existingScripts =
    config.scripts && typeof config.scripts === 'object' && !Array.isArray(config.scripts)
      ? (config.scripts as Record<string, unknown>)
      : {};

  const cleanScripts: Record<string, unknown> = { ...existingScripts };
  if (scripts.setup.trim()) cleanScripts.setup = scripts.setup;
  else delete cleanScripts.setup;
  if (scripts.run.trim()) cleanScripts.run = scripts.run;
  else delete cleanScripts.run;
  if (scripts.stop.trim()) cleanScripts.stop = scripts.stop;
  else delete cleanScripts.stop;
  if (scripts.teardown.trim()) cleanScripts.teardown = scripts.teardown;
  else delete cleanScripts.teardown;

  const { scripts: _scripts, ...rest } = config;
  if (Object.keys(cleanScripts).length === 0) {
    return rest;
  }
  return {
    ...rest,
    scripts: cleanScripts,
  };
}

function preservePatternsFromConfig(config: ConfigShape): string[] {
  const patterns = config.preservePatterns;
  if (!Array.isArray(patterns)) return [];
  return patterns.filter((value): value is string => typeof value === 'string');
}

function applyPreservePatterns(config: ConfigShape, patterns: string[]): ConfigShape {
  const { preservePatterns: _preservePatterns, ...rest } = config;
  if (patterns.length === 0) {
    return rest;
  }
  return {
    ...rest,
    preservePatterns: patterns,
  };
}

function applyShellSetup(config: ConfigShape, shellSetup: string): ConfigShape {
  const { shellSetup: _shellSetup, ...rest } = config;
  const trimmed = shellSetup.trim();
  if (!trimmed) return rest;
  return { ...rest, shellSetup: trimmed };
}

function applyTmux(config: ConfigShape, tmux: boolean): ConfigShape {
  const { tmux: _tmux, ...rest } = config;
  if (!tmux) return rest;
  return { ...rest, tmux: true };
}

function applyWorkspaceProvider(
  config: ConfigShape,
  provisionCommand: string,
  terminateCommand: string
): ConfigShape {
  const { workspaceProvider: _wp, ...rest } = config;
  const provision = provisionCommand.trim();
  const terminate = terminateCommand.trim();
  if (!provision && !terminate) return rest;
  return {
    ...rest,
    workspaceProvider: {
      type: 'script' as const,
      provisionCommand: provision,
      terminateCommand: terminate,
    },
  };
}

function ciAutoFixFromConfig(config: ConfigShape): CiAutoFixConfig | null {
  const ci = config.ciAutoFix;
  if (!ci || typeof ci !== 'object') return null;
  return {
    enabled: ci.enabled,
    mode: ci.mode,
    checkFilters: ci.checkFilters,
  };
}

function applyCiAutoFix(config: ConfigShape, ciAutoFix: CiAutoFixConfig | null): ConfigShape {
  const { ciAutoFix: _ci, ...rest } = config;
  if (!ciAutoFix?.enabled) return rest;
  return { ...rest, ciAutoFix };
}

export const ConfigEditorModal: React.FC<ConfigEditorModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  isRemote,
  sshConnectionId,
}) => {
  const workspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const [config, setConfig] = useState<ConfigShape>({});
  const [scripts, setScripts] = useState<LifecycleScripts>({ ...EMPTY_SCRIPTS });
  const [originalScripts, setOriginalScripts] = useState<LifecycleScripts>({ ...EMPTY_SCRIPTS });
  const [preservePatternsInput, setPreservePatternsInput] = useState('');
  const [originalPreservePatternsInput, setOriginalPreservePatternsInput] = useState('');
  const [shellSetup, setShellSetup] = useState('');
  const [originalShellSetup, setOriginalShellSetup] = useState('');
  const [tmux, setTmux] = useState(false);
  const [originalTmux, setOriginalTmux] = useState(false);
  const [wpProvisionCommand, setWpProvisionCommand] = useState('');
  const [originalWpProvisionCommand, setOriginalWpProvisionCommand] = useState('');
  const [wpTerminateCommand, setWpTerminateCommand] = useState('');
  const [originalWpTerminateCommand, setOriginalWpTerminateCommand] = useState('');
  const [ciAutoFixEnabled, setCiAutoFixEnabled] = useState(false);
  const [originalCiAutoFixEnabled, setOriginalCiAutoFixEnabled] = useState(false);
  const [ciAutoFixMode, setCiAutoFixMode] = useState<'auto' | 'review'>('review');
  const [originalCiAutoFixMode, setOriginalCiAutoFixMode] = useState<'auto' | 'review'>('review');

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const preservePatterns = useMemo(
    () =>
      preservePatternsInput
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [preservePatternsInput]
  );

  const normalizedConfigContent = useMemo(() => {
    const ciAutoFixConfig: CiAutoFixConfig | null = ciAutoFixEnabled
      ? { enabled: true, mode: ciAutoFixMode }
      : null;
    const withPatterns = applyPreservePatterns(config, preservePatterns);
    const withShellSetup = applyShellSetup(withPatterns, shellSetup);
    const withTmux = applyTmux(withShellSetup, tmux);
    const withWp = applyWorkspaceProvider(withTmux, wpProvisionCommand, wpTerminateCommand);
    const withCiAutoFix = applyCiAutoFix(withWp, ciAutoFixConfig);
    const withScripts = applyScripts(withCiAutoFix, scripts);
    return `${JSON.stringify(withScripts, null, 2)}\n`;
  }, [
    config,
    preservePatterns,
    shellSetup,
    tmux,
    wpProvisionCommand,
    wpTerminateCommand,
    scripts,
    ciAutoFixEnabled,
    ciAutoFixMode,
  ]);

  const scriptsDirty = useMemo(
    () =>
      scripts.setup !== originalScripts.setup ||
      scripts.run !== originalScripts.run ||
      scripts.stop !== originalScripts.stop ||
      scripts.teardown !== originalScripts.teardown ||
      preservePatternsInput !== originalPreservePatternsInput ||
      shellSetup !== originalShellSetup ||
      tmux !== originalTmux ||
      wpProvisionCommand !== originalWpProvisionCommand ||
      wpTerminateCommand !== originalWpTerminateCommand,
    [
      originalShellSetup,
      originalPreservePatternsInput,
      originalScripts.run,
      originalScripts.setup,
      originalScripts.stop,
      originalScripts.teardown,
      originalTmux,
      originalWpProvisionCommand,
      originalWpTerminateCommand,
      shellSetup,
      preservePatternsInput,
      scripts.run,
      scripts.setup,
      scripts.stop,
      scripts.teardown,
      tmux,
      wpProvisionCommand,
      wpTerminateCommand,
    ]
  );

  const hasChanges = scriptsDirty;

  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      let content: string;

      if (isRemote && sshConnectionId) {
        const configPath = `${projectPath}/.emdash.json`;
        try {
          content = await window.electronAPI.sshReadFile(sshConnectionId, configPath);
        } catch {
          // File doesn't exist yet on remote — treat as empty config
          content = '{}';
        }
      } else {
        const result = await window.electronAPI.getProjectConfig(projectPath);
        if (!result.success || !result.content) {
          throw new Error(result.error || 'Failed to load config');
        }
        content = result.content;
      }

      const parsed = ensureConfigObject(JSON.parse(content));
      const nextScripts = scriptsFromConfig(parsed);
      const nextPreservePatterns = preservePatternsFromConfig(parsed);
      const nextShellSetup = typeof parsed.shellSetup === 'string' ? parsed.shellSetup : '';
      const nextTmux = parsed.tmux === true;
      const wp = parsed.workspaceProvider;
      const nextWpProvision =
        wp && typeof wp === 'object' && typeof wp.provisionCommand === 'string'
          ? wp.provisionCommand
          : '';
      const nextWpTerminate =
        wp && typeof wp === 'object' && typeof wp.terminateCommand === 'string'
          ? wp.terminateCommand
          : '';
      setConfig(parsed);
      setScripts(nextScripts);
      setOriginalScripts(nextScripts);
      setPreservePatternsInput(nextPreservePatterns.join('\n'));
      setOriginalPreservePatternsInput(nextPreservePatterns.join('\n'));
      setShellSetup(nextShellSetup);
      setOriginalShellSetup(nextShellSetup);
      setTmux(nextTmux);
      setOriginalTmux(nextTmux);
      setWpProvisionCommand(nextWpProvision);
      setOriginalWpProvisionCommand(nextWpProvision);
      setWpTerminateCommand(nextWpTerminate);
      setOriginalWpTerminateCommand(nextWpTerminate);
    } catch (err) {
      setConfig({});
      setScripts({ ...EMPTY_SCRIPTS });
      setOriginalScripts({ ...EMPTY_SCRIPTS });
      setPreservePatternsInput('');
      setOriginalPreservePatternsInput('');
      setShellSetup('');
      setOriginalShellSetup('');
      setTmux(false);
      setOriginalTmux(false);
      setWpProvisionCommand('');
      setOriginalWpProvisionCommand('');
      setWpTerminateCommand('');
      setOriginalWpTerminateCommand('');
      setError(err instanceof Error ? err.message : 'Failed to load config');
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath, isRemote, sshConnectionId]);

  useEffect(() => {
    if (!isOpen || !projectPath) return;
    void loadConfig();
  }, [isOpen, loadConfig, projectPath]);

  const handleOpenChange = (open: boolean) => {
    if (!open && isSaving) return;
    if (!open) onClose();
  };

  const handleScriptChange =
    (key: keyof LifecycleScripts) => (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setScripts((prev) => ({ ...prev, [key]: value }));
      setError(null);
    };

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (isRemote && sshConnectionId) {
        const configPath = `${projectPath}/.emdash.json`;
        await window.electronAPI.sshWriteFile(sshConnectionId, configPath, normalizedConfigContent);
      } else {
        const result = await window.electronAPI.saveProjectConfig(
          projectPath,
          normalizedConfigContent
        );
        if (!result.success) {
          throw new Error(result.error || 'Failed to save config');
        }
      }

      // Gitignore workspace provider script paths (best-effort, local only)
      if (!isRemote) {
        const scriptPaths = [wpProvisionCommand.trim(), wpTerminateCommand.trim()].filter(
          (cmd) => cmd && (cmd.startsWith('./') || (cmd.includes('/') && !cmd.includes(' ')))
        );
        if (scriptPaths.length > 0) {
          void window.electronAPI.ensureGitignore(projectPath, scriptPaths);
        }
      }

      const nextConfig = applyScripts(
        applyWorkspaceProvider(
          applyTmux(
            applyShellSetup(applyPreservePatterns(config, preservePatterns), shellSetup),
            tmux
          ),
          wpProvisionCommand,
          wpTerminateCommand
        ),
        scripts
      );
      setConfig(nextConfig);
      setOriginalScripts(scripts);
      setOriginalPreservePatternsInput(preservePatternsInput);
      setOriginalShellSetup(shellSetup);
      setOriginalTmux(tmux);
      setOriginalWpProvisionCommand(wpProvisionCommand);
      setOriginalWpTerminateCommand(wpTerminateCommand);

      if (
        wpProvisionCommand !== originalWpProvisionCommand ||
        wpTerminateCommand !== originalWpTerminateCommand
      ) {
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('workspace_provider_config_saved');
        });
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setIsSaving(false);
    }
  }, [
    config,
    isRemote,
    normalizedConfigContent,
    onClose,
    shellSetup,
    sshConnectionId,
    preservePatternsInput,
    preservePatterns,
    projectPath,
    scripts,
    tmux,
    wpProvisionCommand,
    wpTerminateCommand,
  ]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Project config</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" />
          </div>
        ) : loadFailed ? (
          <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        ) : (
          <>
            {error ? (
              <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <div className="space-y-2">
                <Label htmlFor="config-preserve-patterns">Preserved patterns</Label>
                <Textarea
                  id="config-preserve-patterns"
                  value={preservePatternsInput}
                  onChange={(event) => {
                    setPreservePatternsInput(event.target.value);
                    setError(null);
                  }}
                  placeholder={['.env', '.env.local', 'config/local.yml', 'secrets/*.json'].join(
                    '\n'
                  )}
                  className="min-h-[104px] font-mono text-xs"
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Files copied to new tasks. One glob pattern per line.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="config-shell-setup">Shell setup</Label>
                <Input
                  id="config-shell-setup"
                  value={shellSetup}
                  onChange={(event) => {
                    setShellSetup(event.target.value);
                    setError(null);
                  }}
                  placeholder="No shell setup configured"
                  className="font-mono text-xs"
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Runs in every terminal before the shell starts.
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="config-tmux">tmux session persistence</Label>
                  <p className="text-xs text-muted-foreground">
                    Wrap agent sessions in tmux so they survive disconnects and restarts.
                  </p>
                </div>
                <Switch
                  id="config-tmux"
                  checked={tmux}
                  onCheckedChange={(checked) => {
                    setTmux(checked);
                    setError(null);
                  }}
                  disabled={isSaving}
                />
              </div>

              {workspaceProviderEnabled && (
                <div className="space-y-2">
                  <Label>Workspace provider</Label>
                  <p className="text-xs text-muted-foreground">
                    Shell commands to provision and tear down remote workspaces. When configured,
                    tasks can choose between a local worktree and a remote workspace.{' '}
                    <a
                      href="https://docs.emdash.sh/bring-your-own-infrastructure"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      View docs
                    </a>
                  </p>
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="space-y-1">
                      <Label htmlFor="config-wp-provision" className="text-xs">
                        Provision command
                      </Label>
                      <Input
                        id="config-wp-provision"
                        value={wpProvisionCommand}
                        onChange={(event) => {
                          setWpProvisionCommand(event.target.value);
                          setError(null);
                        }}
                        placeholder="./scripts/create-workspace.sh"
                        className="font-mono text-xs"
                        disabled={isSaving}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Script that creates a workspace and outputs SSH connection details as JSON
                        to stdout. Receives EMDASH_TASK_ID, EMDASH_REPO_URL, EMDASH_BRANCH,
                        EMDASH_BASE_REF as env vars.
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="config-wp-terminate" className="text-xs">
                        Terminate command
                      </Label>
                      <Input
                        id="config-wp-terminate"
                        value={wpTerminateCommand}
                        onChange={(event) => {
                          setWpTerminateCommand(event.target.value);
                          setError(null);
                        }}
                        placeholder="./scripts/destroy-workspace.sh"
                        className="font-mono text-xs"
                        disabled={isSaving}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Script that destroys the workspace when the task is deleted. Receives
                        EMDASH_INSTANCE_ID and EMDASH_TASK_ID as env vars.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="config-scripts-setup">Setup script</Label>
                <Textarea
                  id="config-scripts-setup"
                  value={scripts.setup}
                  onChange={handleScriptChange('setup')}
                  placeholder="No setup script configured"
                  className="min-h-[84px] font-mono text-xs"
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Runs once right after a new task is created.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="config-scripts-run">Run script</Label>
                <Textarea
                  id="config-scripts-run"
                  value={scripts.run}
                  onChange={handleScriptChange('run')}
                  placeholder="No run script configured"
                  className="min-h-[84px] font-mono text-xs"
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Long-running command for the task (start/stop from the task terminal).
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="config-scripts-stop">Stop script</Label>
                <Textarea
                  id="config-scripts-stop"
                  value={scripts.stop}
                  onChange={handleScriptChange('stop')}
                  placeholder="No stop script configured"
                  className="min-h-[84px] font-mono text-xs"
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Runs when the run script is stopped. The run process is killed after this
                  completes.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="config-scripts-teardown">Teardown script</Label>
                <Textarea
                  id="config-scripts-teardown"
                  value={scripts.teardown}
                  onChange={handleScriptChange('teardown')}
                  placeholder="No teardown script configured"
                  className="min-h-[84px] font-mono text-xs"
                  disabled={isSaving}
                />
                <p className="text-xs text-muted-foreground">
                  Runs when a task is being deleted or archived.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 border-t pt-4">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs underline-offset-2 hover:underline"
                onClick={() => window.electronAPI.openExternal(PROJECT_CONFIG_DOCS_URL)}
              >
                Check docs for examples ↗
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSave} disabled={!hasChanges || isSaving}>
                  {isSaving ? (
                    <>
                      <Spinner size="sm" className="mr-2" />
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
