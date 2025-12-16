import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Save } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useToast } from '../hooks/use-toast';

interface RunConfigEditorModalProps {
  open: boolean;
  onClose: () => void;
  projectPath: string;
  onSave?: () => void;
}

export const RunConfigEditorModal: React.FC<RunConfigEditorModalProps> = ({
  open,
  onClose,
  projectPath,
  onSave,
}) => {
  const [editorValue, setEditorValue] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [dirty, setDirty] = useState<boolean>(false);
  const [isDark, setIsDark] = useState(false);
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
    window.electronAPI
      .worktreeRunLoadConfig({ projectPath })
      .then((result) => {
        if (result.ok && result.config) {
          setEditorValue(JSON.stringify(result.config, null, 2));
          setDirty(false);
        } else if (result.ok && !result.exists) {
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
      const result = await window.electronAPI.worktreeRunSaveConfig({
        projectPath,
        config,
      });

      if (!result.ok) {
        throw new Error(result.error || 'Failed to save');
      }

      setDirty(false);
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
            className="flex h-[70vh] w-[60vw] transform-gpu flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 bg-white/80 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                Edit Run Configuration
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900/40"
                  title="Save (Cmd/Ctrl+S)"
                >
                  <Save className="h-3.5 w-3.5" /> Save
                </button>
                <button
                  onClick={handleClose}
                  className="rounded-md p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Editor */}
            <div className="relative flex-1 overflow-hidden">
              {loading ? (
                <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                  Loading configuration...
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
            <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Cmd/Ctrl+S to save • Esc to close
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
