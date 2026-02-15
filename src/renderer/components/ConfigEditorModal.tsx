import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
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
};

interface ConfigEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
}

const EMPTY_SCRIPTS: LifecycleScripts = {
  setup: '',
  run: '',
  teardown: '',
};

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

export const ConfigEditorModal: React.FC<ConfigEditorModalProps> = ({
  isOpen,
  onClose,
  projectPath,
}) => {
  const [config, setConfig] = useState<ConfigShape>({});
  const [scripts, setScripts] = useState<LifecycleScripts>({ ...EMPTY_SCRIPTS });
  const [originalScripts, setOriginalScripts] = useState<LifecycleScripts>({ ...EMPTY_SCRIPTS });
  const [preservePatternsInput, setPreservePatternsInput] = useState('');
  const [originalPreservePatternsInput, setOriginalPreservePatternsInput] = useState('');
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
    const withScripts = applyScripts(withPatterns, scripts);
    return `${JSON.stringify(withScripts, null, 2)}\n`;
  }, [config, preservePatterns, scripts]);

  const scriptsDirty = useMemo(
    () =>
      scripts.setup !== originalScripts.setup ||
      scripts.run !== originalScripts.run ||
      scripts.teardown !== originalScripts.teardown ||
      preservePatternsInput !== originalPreservePatternsInput,
    [
      originalPreservePatternsInput,
      originalScripts.run,
      originalScripts.setup,
      originalScripts.teardown,
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
      const result = await window.electronAPI.getProjectConfig(projectPath);
      if (!result.success || !result.content) {
        throw new Error(result.error || 'Failed to load config');
      }

      const parsed = ensureConfigObject(JSON.parse(result.content));
      const nextScripts = scriptsFromConfig(parsed);
      const nextPreservePatterns = preservePatternsFromConfig(parsed);
      setConfig(parsed);
      setScripts(nextScripts);
      setOriginalScripts(nextScripts);
      setPreservePatternsInput(nextPreservePatterns.join('\n'));
      setOriginalPreservePatternsInput(nextPreservePatterns.join('\n'));
    } catch (err) {
      setConfig({});
      setScripts({ ...EMPTY_SCRIPTS });
      setOriginalScripts({ ...EMPTY_SCRIPTS });
      setPreservePatternsInput('');
      setOriginalPreservePatternsInput('');
      setError(err instanceof Error ? err.message : 'Failed to load config');
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath]);

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
      const result = await window.electronAPI.saveProjectConfig(
        projectPath,
        normalizedConfigContent
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to save config');
      }

      const nextConfig = applyScripts(applyPreservePatterns(config, preservePatterns), scripts);
      setConfig(nextConfig);
      setOriginalScripts(scripts);
      setOriginalPreservePatternsInput(preservePatternsInput);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setIsSaving(false);
    }
  }, [
    config,
    normalizedConfigContent,
    onClose,
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

            <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
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

            <div className="flex justify-end gap-2 border-t mt-4 pt-4">
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
