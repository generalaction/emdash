import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';
import { Textarea } from './ui/textarea';

type LifecycleScripts = {
  setup: string;
  run: string;
  teardown: string;
};

type ConfigShape = Record<string, unknown> & {
  preservePatterns?: string[];
  scripts?: Partial<LifecycleScripts>;
  shellSetup?: string;
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

export const ConfigEditorModal: React.FC<ConfigEditorModalProps> = ({
  isOpen,
  onClose,
  projectPath,
  isRemote,
  sshConnectionId,
}) => {
  const [config, setConfig] = useState<ConfigShape>({});
  const [scripts, setScripts] = useState<LifecycleScripts>({ ...EMPTY_SCRIPTS });
  const [originalScripts, setOriginalScripts] = useState<LifecycleScripts>({ ...EMPTY_SCRIPTS });
  const [preservePatternsInput, setPreservePatternsInput] = useState('');
  const [originalPreservePatternsInput, setOriginalPreservePatternsInput] = useState('');
  const [shellSetup, setShellSetup] = useState('');
  const [originalShellSetup, setOriginalShellSetup] = useState('');
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
    const withPatterns = applyPreservePatterns(config, preservePatterns);
    const withShellSetup = applyShellSetup(withPatterns, shellSetup);
    const withScripts = applyScripts(withShellSetup, scripts);
    return `${JSON.stringify(withScripts, null, 2)}\n`;
  }, [config, preservePatterns, shellSetup, scripts]);

  const scriptsDirty = useMemo(
    () =>
      scripts.setup !== originalScripts.setup ||
      scripts.run !== originalScripts.run ||
      scripts.teardown !== originalScripts.teardown ||
      preservePatternsInput !== originalPreservePatternsInput ||
      shellSetup !== originalShellSetup,
    [
      originalShellSetup,
      originalPreservePatternsInput,
      originalScripts.run,
      originalScripts.setup,
      originalScripts.teardown,
      shellSetup,
      preservePatternsInput,
      scripts.run,
      scripts.setup,
      scripts.teardown,
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
      setConfig(parsed);
      setScripts(nextScripts);
      setOriginalScripts(nextScripts);
      setPreservePatternsInput(nextPreservePatterns.join('\n'));
      setOriginalPreservePatternsInput(nextPreservePatterns.join('\n'));
      setShellSetup(nextShellSetup);
      setOriginalShellSetup(nextShellSetup);
    } catch (err) {
      setConfig({});
      setScripts({ ...EMPTY_SCRIPTS });
      setOriginalScripts({ ...EMPTY_SCRIPTS });
      setPreservePatternsInput('');
      setOriginalPreservePatternsInput('');
      setShellSetup('');
      setOriginalShellSetup('');
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

      const nextConfig = applyScripts(
        applyShellSetup(applyPreservePatterns(config, preservePatterns), shellSetup),
        scripts
      );
      setConfig(nextConfig);
      setOriginalScripts(scripts);
      setOriginalPreservePatternsInput(preservePatternsInput);
      setOriginalShellSetup(shellSetup);
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
