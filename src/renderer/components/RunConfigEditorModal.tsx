import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useToast } from '../hooks/use-toast';
import { getWorkspaceProviderPreference } from '../utils/providerPreference';

// Type helper to access worktreeRun methods
type WorktreeRunConfigAPI = {
  worktreeRunLoadConfig: (args: { projectPath: string }) => Promise<{
    ok: boolean;
    config: any | null;
    exists: boolean;
    error?: string;
  }>;
  worktreeRunSaveConfig: (args: {
    projectPath: string;
    config: any;
  }) => Promise<{ ok: boolean; error?: string }>;
  worktreeRunDeleteConfig: (args: { projectPath: string }) => Promise<{
    ok: boolean;
    deleted?: boolean;
    message?: string;
    error?: string;
  }>;
  worktreeRunRegenerateConfig: (args: {
    projectPath: string;
    preferredProvider?: string;
  }) => Promise<{
    ok: boolean;
    config?: any;
    reasoning?: string;
    error?: string;
  }>;
};

interface RunConfigEditorModalProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  workspaceId?: string | null;
  onSave?: () => void;
}

export const RunConfigEditorModal: React.FC<RunConfigEditorModalProps> = ({
  open,
  onClose,
  projectPath,
  workspaceId,
  onSave,
}) => {
  const [editorValue, setEditorValue] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [dirty, setDirty] = useState<boolean>(false);
  const [isDark, setIsDark] = useState(false);
  const [configExists, setConfigExists] = useState<boolean>(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();

  // Detect dark mode
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkDarkMode = () => {
      setIsDark(
        document.documentElement.classList.contains('dark') ||
          window.matchMedia('(prefers-color-scheme: dark)').matches
      );
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', checkDarkMode);
    };
  }, []);

  // Sync scroll between textarea and syntax highlighter
  useEffect(() => {
    if (!textareaRef.current || !highlightRef.current) return;

    const textarea = textareaRef.current;
    const highlight = highlightRef.current;

    const syncScroll = () => {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    };

    textarea.addEventListener('scroll', syncScroll);
    return () => {
      textarea.removeEventListener('scroll', syncScroll);
    };
  }, [editorValue]);

  // Load config when modal opens
  useEffect(() => {
    if (!open || !projectPath) return;

    setLoading(true);
    (window.electronAPI as WorktreeRunConfigAPI & typeof window.electronAPI)
      .worktreeRunLoadConfig({ projectPath })
      .then((result: {
        ok: boolean;
        config: any | null;
        exists: boolean;
        error?: string;
      }) => {
        if (result.ok && result.config) {
          setEditorValue(JSON.stringify(result.config, null, 2));
          setDirty(false);
          setConfigExists(true);
        } else if (result.ok && !result.exists) {
          setConfigExists(false);
          // No config - create default
          const defaultConfig = {
            version: 1,
            packageManager: 'npm',
            install: 'npm install',
            scripts: [
              {
                name: 'dev',
                command: 'npm run dev',
                port: null,
                cwd: '.',
                preview: true,
              },
            ],
            env: {},
            setupSteps: [],
          };
          setEditorValue(JSON.stringify(defaultConfig, null, 2));
          setDirty(false);
        } else {
          toast({
            title: 'Failed to load config',
            description: result.error || 'Unknown error',
            variant: 'destructive',
          });
        }
      })
      .finally(() => {
        setLoading(false);
        setTimeout(() => textareaRef.current?.focus(), 0);
      });
  }, [open, projectPath, toast]);

  const handleSave = async () => {
    try {
      // Validate JSON
      const config = JSON.parse(editorValue);

      // Save via IPC
      const result = await (window.electronAPI as WorktreeRunConfigAPI & typeof window.electronAPI).worktreeRunSaveConfig({
        projectPath,
        config,
      });

      if (!result.ok) {
        throw new Error(result.error || 'Failed to save');
      }

      setDirty(false);
      setConfigExists(true);
      toast({ title: 'Saved', description: 'Run configuration updated' });
      if (onSave) onSave();
    } catch (err: any) {
      toast({
        title: 'Save failed',
        description: err?.message || 'Invalid JSON or save error',
        variant: 'destructive',
      });
    }
  };

  const handleRegenerate = async () => {
    const confirmed = window.confirm(
      'Regenerate configuration using AI? This will overwrite the current configuration.'
    );
    if (!confirmed) return;

    // Get preferred provider from workspace preference
    const preferredProvider = getWorkspaceProviderPreference(workspaceId) || undefined;

    setRegenerating(true);
    try {
      const result = await (window.electronAPI as WorktreeRunConfigAPI & typeof window.electronAPI).worktreeRunRegenerateConfig({
        projectPath,
        preferredProvider,
      });

      if (!result.ok) {
        throw new Error(result.error || 'Failed to regenerate');
      }

      if (result.config) {
        setEditorValue(JSON.stringify(result.config, null, 2));
        setDirty(false);
        setConfigExists(true);
        toast({
          title: 'Regenerated',
          description: 'Configuration regenerated successfully using AI.',
        });
        if (onSave) onSave();
      } else {
        throw new Error('No config returned from generation');
      }
    } catch (err: any) {
      toast({
        title: 'Regeneration failed',
        description: err?.message || 'Failed to regenerate configuration',
        variant: 'destructive',
      });
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = async () => {
    if (!configExists) {
      toast({
        title: 'No config to delete',
        description: 'Configuration file does not exist',
        variant: 'destructive',
      });
      return;
    }

    const confirmed = window.confirm(
      'Delete this configuration? The next run will trigger AI generation to create a new one.'
    );
    if (!confirmed) return;

    try {
      const result = await (window.electronAPI as WorktreeRunConfigAPI & typeof window.electronAPI).worktreeRunDeleteConfig({
        projectPath,
      });

      if (!result.ok) {
        throw new Error(result.error || 'Failed to delete');
      }

      setConfigExists(false);
      setEditorValue('');
      setDirty(false);
      toast({ 
        title: 'Deleted', 
        description: 'Configuration deleted. Next run will generate a new config.' 
      });
      if (onSave) onSave();
      onClose();
    } catch (err: any) {
      toast({
        title: 'Delete failed',
        description: err?.message || 'Failed to delete configuration',
        variant: 'destructive',
      });
    }
  };

  const handleClose = () => {
    if (dirty) {
      const proceed = window.confirm('Discard unsaved changes?');
      if (!proceed) return;
    }
    onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 6, scale: 0.995 }
            }
            className="flex h-[70vh] w-[60vw] transform-gpu flex-col overflow-hidden rounded-2xl border border-gray-200/50 bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] dark:border-gray-700/50 dark:bg-gray-900 dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200/80 bg-white/95 px-5 py-3 backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-900/95">
              <div className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
                Run Configuration
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating || loading}
                  className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  title="Regenerate with AI"
                >
                  {regenerating ? 'Generating' : 'Regenerate'}
                </button>
                {configExists && (
                  <button
                    onClick={handleDelete}
                    disabled={regenerating || loading}
                    className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    title="Delete configuration"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={regenerating || loading}
                  className="inline-flex items-center gap-1 rounded border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  title="Save (⌘S)"
                >
                  Save
                </button>
                <button
                  onClick={handleClose}
                  disabled={regenerating}
                  className="inline-flex items-center justify-center rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Editor */}
            <div className="relative flex-1 overflow-hidden">
              {loading || regenerating ? (
                <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                  {regenerating ? (
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      <div>Generating configuration with AI...</div>
                    </div>
                  ) : (
                    'Loading configuration...'
                  )}
                </div>
              ) : (
                <div className="relative h-full w-full">
                  {/* Syntax highlighter (background) */}
                  <div
                    ref={highlightRef}
                    className="pointer-events-none absolute inset-0 overflow-auto p-3"
                  >
                    <SyntaxHighlighter
                      language="json"
                      style={isDark ? oneDark : oneLight}
                      customStyle={{
                        margin: 0,
                        padding: 0,
                        background: 'transparent',
                        backgroundColor: 'transparent',
                        fontSize: '12px',
                        lineHeight: '1.25rem',
                        fontFamily:
                          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        textShadow: 'none',
                      }}
                      PreTag="div"
                      CodeTag="code"
                      wrapLines={true}
                      wrapLongLines={true}
                    >
                      {editorValue || ' '}
                    </SyntaxHighlighter>
                  </div>

                  {/* Transparent textarea (foreground) */}
                  <textarea
                    ref={textareaRef}
                    className="relative h-full w-full resize-none border-0 bg-transparent p-3 font-mono text-[12px] leading-5 text-transparent caret-gray-900 outline-none dark:caret-gray-100"
                    style={{
                      color: 'transparent',
                      WebkitTextFillColor: 'transparent',
                      caretColor: isDark ? '#f3f4f6' : '#111827',
                    }}
                    value={editorValue}
                    onChange={(e) => {
                      setEditorValue(e.target.value);
                      setDirty(true);
                    }}
                    spellCheck={false}
                    onKeyDown={(e) => {
                      const isMeta = e.metaKey || e.ctrlKey;
                      if (isMeta && e.key.toLowerCase() === 's') {
                        e.preventDefault();
                        handleSave();
                      }
                      if (e.key === 'Escape') {
                        handleClose();
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* Footer hint */}
            <div className="border-t border-gray-200/80 bg-gray-50/50 px-5 py-2.5 text-[11px] tracking-wide text-gray-500 backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-900/50 dark:text-gray-400">
              <span className="font-mono">⌘S</span> to save · <span className="font-mono">Esc</span> to close
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
