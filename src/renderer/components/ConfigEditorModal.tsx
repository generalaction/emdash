import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Spinner } from './ui/spinner';
import Editor, { Monaco } from '@monaco-editor/react';
import { useTheme } from '@/hooks/useTheme';
import { defineMonacoThemes, getMonacoTheme } from '@/lib/monaco-themes';

interface ConfigEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
}

export const ConfigEditorModal: React.FC<ConfigEditorModalProps> = ({
  isOpen,
  onClose,
  projectPath,
}) => {
  const { effectiveTheme } = useTheme();
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const hasChanges = content !== originalContent;

  const handleEditorBeforeMount = useCallback((monaco: Monaco) => {
    // Register themes before editor creation so custom-dark/custom-black apply immediately.
    defineMonacoThemes(monaco);
  }, []);

  // Load config when modal opens
  useEffect(() => {
    if (!isOpen || !projectPath) return;

    const loadConfig = async () => {
      setIsLoading(true);
      setError(null);
      setJsonError(null);

      try {
        const result = await window.electronAPI.getProjectConfig(projectPath);
        if (result.success && result.content) {
          setContent(result.content);
          setOriginalContent(result.content);
        } else {
          // Clear content when load fails to prevent stale data
          setContent('');
          setOriginalContent('');
          setError(result.error || 'Failed to load config');
        }
      } catch (err) {
        // Clear content when load fails to prevent stale data
        setContent('');
        setOriginalContent('');
        setError(err instanceof Error ? err.message : 'Failed to load config');
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, [isOpen, projectPath]);

  // Validate JSON on content change
  useEffect(() => {
    if (!content) {
      setJsonError(null);
      return;
    }

    try {
      JSON.parse(content);
      setJsonError(null);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setJsonError(err.message);
      }
    }
  }, [content]);

  const handleSave = useCallback(async () => {
    if (jsonError) return;

    setIsSaving(true);
    setError(null);

    try {
      const result = await window.electronAPI.saveProjectConfig(projectPath, content);
      if (result.success) {
        setOriginalContent(content);
        onClose();
      } else {
        setError(result.error || 'Failed to save config');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setIsSaving(false);
    }
  }, [projectPath, content, jsonError, onClose]);

  const handleOpenChange = (open: boolean) => {
    if (!open && isSaving) return;
    if (!open) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Edit Project Config</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="md" />
          </div>
        ) : error && !content ? (
          <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        ) : (
          <>
            <div
              className={`min-h-0 flex-1 overflow-hidden rounded-md border ${isSaving ? 'opacity-75' : ''}`}
            >
              <Editor
                height="400px"
                language="json"
                value={content}
                onChange={(value) => setContent(value || '')}
                beforeMount={handleEditorBeforeMount}
                theme={getMonacoTheme(effectiveTheme)}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: 'on',
                  readOnly: isSaving, // Disable editing while saving
                }}
              />
            </div>

            {jsonError && (
              <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                Invalid JSON: {jsonError}
              </div>
            )}

            {error && content && (
              <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || !!jsonError || isSaving}
              >
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
