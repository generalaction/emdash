import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const INSIDE_PROJECT_VALUE = '.worktrees';
const TEMPORARY_VALUE = '/tmp/emdash';

type WorktreeBasePathMode = 'default' | 'inside' | 'temporary' | 'custom';

function getModeFromValue(value?: string | null): WorktreeBasePathMode {
  const trimmed = value?.trim() || '';
  if (!trimmed) return 'default';
  if (trimmed === INSIDE_PROJECT_VALUE) return 'inside';
  if (trimmed === TEMPORARY_VALUE) return 'temporary';
  return 'custom';
}

interface WorktreeBasePathControlsProps {
  projectPath: string;
  value?: string | null;
  isSaving: boolean;
  onSave: (nextValue: string | null) => Promise<void>;
}

const WorktreeBasePathControls: React.FC<WorktreeBasePathControlsProps> = ({
  projectPath,
  value,
  isSaving,
  onSave,
}) => {
  const [mode, setMode] = useState<WorktreeBasePathMode>(() => getModeFromValue(value));
  const [customPath, setCustomPath] = useState<string>(() =>
    getModeFromValue(value) === 'custom' ? (value || '').trim() : ''
  );

  useEffect(() => {
    const nextMode = getModeFromValue(value);
    setMode(nextMode);
    setCustomPath(nextMode === 'custom' ? (value || '').trim() : '');
  }, [value]);

  const saveCustomPath = useCallback(
    async (pathValue: string) => {
      const trimmed = pathValue.trim();
      if (!trimmed) return;
      const current = (value || '').trim();
      if (trimmed === current) return;
      await onSave(trimmed);
    },
    [onSave, value]
  );

  const handleModeChange = useCallback(
    (nextMode: string) => {
      const typedMode = nextMode as WorktreeBasePathMode;
      setMode(typedMode);

      if (typedMode === 'default') {
        void onSave(null);
        return;
      }
      if (typedMode === 'inside') {
        void onSave(INSIDE_PROJECT_VALUE);
        return;
      }
      if (typedMode === 'temporary') {
        void onSave(TEMPORARY_VALUE);
      }
    },
    [onSave]
  );

  const browseForDirectory = useCallback(async () => {
    const defaultPath = customPath.trim() || projectPath;
    const result = await window.electronAPI.selectDirectory({
      title: 'Select worktree base directory',
      defaultPath,
    });
    if (!result?.success || !result.path) return;
    setCustomPath(result.path);
    await saveCustomPath(result.path);
  }, [customPath, projectPath, saveCustomPath]);

  const helperText = useMemo(() => {
    if (mode === 'default') return 'Default: ../worktrees (relative to your project)';
    if (mode === 'inside') return 'Inside project: .worktrees';
    if (mode === 'temporary') return 'Temporary: /tmp/emdash';
    return 'Custom directory path for new worktrees';
  }, [mode]);

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="space-y-1">
        <Label className="text-sm font-medium text-foreground">Worktree location</Label>
        <p className="text-xs text-muted-foreground">{helperText}</p>
      </div>

      <Select value={mode} onValueChange={handleModeChange} disabled={isSaving}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Select worktree location" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default (../worktrees)</SelectItem>
          <SelectItem value="inside">Inside project (.worktrees)</SelectItem>
          <SelectItem value="temporary">Temporary (/tmp/emdash)</SelectItem>
          <SelectItem value="custom">Custom path</SelectItem>
        </SelectContent>
      </Select>

      {mode === 'custom' ? (
        <div className="flex gap-2">
          <Input
            value={customPath}
            onChange={(event) => setCustomPath(event.target.value)}
            onBlur={() => {
              void saveCustomPath(customPath);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveCustomPath(customPath);
              }
            }}
            placeholder="Choose a custom worktree base path"
            disabled={isSaving}
            className="h-8 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void browseForDirectory();
            }}
            disabled={isSaving}
            className="h-8 px-2"
            aria-label="Browse for custom worktree directory"
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default WorktreeBasePathControls;
