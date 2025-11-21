import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Save, Undo2, ChevronDown, ChevronRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useFileDiff, type DiffLine } from '../hooks/useFileDiff';
import { type FileChange } from '../hooks/useFileChanges';
import { useToast } from '../hooks/use-toast';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getLanguageFromPath } from '../lib/languageUtils';

interface ChangesDiffModalProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  files: FileChange[];
  initialFile?: string;
  onRefreshChanges?: () => Promise<void> | void;
}

// Component for rendering a single line with syntax highlighting
const HighlightedLine: React.FC<{
  text: string;
  type: DiffLine['type'];
  language: string;
  isDark: boolean;
}> = ({ text, type, language, isDark }) => {
  // Hooks must be called before any conditional returns
  const lineRef = useRef<HTMLDivElement>(null);

  const lineContent = text || ' ';

  useEffect(() => {
    if (lineRef.current) {
      // Force transparent backgrounds and remove text shadows on all nested elements
      const allElements = lineRef.current.querySelectorAll('pre, code, span');
      allElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.setProperty('background', 'transparent', 'important');
        htmlEl.style.setProperty('background-color', 'transparent', 'important');
        htmlEl.style.setProperty('text-shadow', 'none', 'important');
      });
    }
  }, [lineContent, language, isDark]);

  const bgClass =
    type === 'add'
      ? 'bg-emerald-50 dark:bg-emerald-900/30'
      : type === 'del'
        ? 'bg-rose-50 dark:bg-rose-900/30'
        : 'bg-transparent';

  // For empty lines, just render a space
  if (lineContent.trim() === '' && lineContent === '') {
    return (
      <div className={`px-3 py-0.5 font-mono text-[12px] leading-5 ${bgClass}`}>{'\u00A0'}</div>
    );
  }

  return (
    <div className={`relative ${bgClass} overflow-x-auto`} data-diff-syntax-highlight>
      <div
        ref={lineRef}
        className="px-3 py-0.5 [&_code]:!bg-transparent [&_pre]:!bg-transparent [&_span]:!bg-transparent"
      >
        <SyntaxHighlighter
          language={language}
          style={isDark ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            padding: 0,
            background: 'transparent',
            backgroundColor: 'transparent',
            fontSize: '12px',
            lineHeight: '1.25rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            display: 'block',
            textShadow: 'none',
          }}
          PreTag="div"
          CodeTag="code"
          wrapLines={false}
          wrapLongLines={true}
        >
          {lineContent}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

export const ChangesDiffModal: React.FC<ChangesDiffModalProps> = ({
  open,
  onClose,
  workspacePath,
  files,
  initialFile,
  onRefreshChanges,
}) => {
  const [selected, setSelected] = useState<string | undefined>(initialFile || files[0]?.path);
  const [refreshKey, setRefreshKey] = useState(0);
  const { lines, loading } = useFileDiff(workspacePath, selected, refreshKey);
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [isDark, setIsDark] = useState(false);

  // Detect if dark mode is active (reactive)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkDarkMode = () => {
      setIsDark(
        document.documentElement.classList.contains('dark') ||
          window.matchMedia('(prefers-color-scheme: dark)').matches
      );
    };

    checkDarkMode();

    // Watch for theme changes
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

  // Get language for current file
  const language = useMemo(() => {
    return selected ? getLanguageFromPath(selected) : 'text';
  }, [selected]);

  // Reset expanded sections when file changes
  useEffect(() => {
    setExpandedSections(new Set());
  }, [selected]);

  // Inline edit mode state (right pane)
  const [isEditing, setIsEditing] = useState(false);
  const [editorValue, setEditorValue] = useState<string>('');
  const [editorLoading, setEditorLoading] = useState<boolean>(false);
  const [dirty, setDirty] = useState<boolean>(false);
  const [eol, setEol] = useState<'\n' | '\r\n'>('\n');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Ref for syntax highlight container in edit mode
  const highlightRef = useRef<HTMLDivElement>(null);

  // Sync scroll between textarea and syntax highlighter in edit mode
  useEffect(() => {
    if (!isEditing || !textareaRef.current || !highlightRef.current) return;

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
  }, [isEditing, editorValue]);

  // Load working copy when toggling into edit mode
  const loadWorkingCopy = async (pathRel: string) => {
    setEditorLoading(true);
    try {
      const res = await window.electronAPI.fsRead(workspacePath, pathRel, 512 * 1024);
      if (!res?.success) {
        toast({ title: 'Cannot Edit', description: res?.error || 'Failed to read file.' });
        setIsEditing(false);
        return;
      }
      if (res.truncated) {
        toast({ title: 'File Too Large', description: 'Inline editing limited to ~500KB.' });
        setIsEditing(false);
        return;
      }
      const content = String(res.content || '');
      const detectedEol = content.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
      setEol(detectedEol as any);
      setEditorValue(content);
      setDirty(false);
      // Focus after next paint
      setTimeout(() => textareaRef.current?.focus(), 0);
    } catch (e) {
      toast({ title: 'Cannot Edit', description: 'Failed to read file.' });
      setIsEditing(false);
    } finally {
      setEditorLoading(false);
    }
  };

  // Exit edit mode on file switch, with confirmation if dirty
  const switchFile = async (nextPath: string) => {
    if (isEditing && dirty) {
      const proceed = window.confirm('Discard unsaved changes?');
      if (!proceed) return;
    }
    setSelected(nextPath);
    setIsEditing(false);
    setDirty(false);
  };

  // Group lines into sections with collapsible context
  type DiffSection =
    | {
        type: 'context';
        startIdx: number;
        endIdx: number;
        startLine: number;
        endLine: number;
        lines: DiffLine[];
      }
    | { type: 'diff'; lines: Array<{ left?: DiffLine; right?: DiffLine }> };

  const sections = useMemo(() => {
    const result: DiffSection[] = [];
    let currentContext: DiffLine[] = [];
    let currentDiff: Array<{ left?: DiffLine; right?: DiffLine }> = [];
    let contextStartIdx = 0;
    let sectionIdx = 0;
    let leftLineNumber = 1; // Track line numbers in the left (original) file
    // Note: For context sections, line numbers are the same in both files
    let contextStartLine = 1;

    const flushContext = () => {
      if (currentContext.length > 0) {
        const contextEndLine = contextStartLine + currentContext.length - 1;
        result.push({
          type: 'context',
          startIdx: contextStartIdx,
          endIdx: contextStartIdx + currentContext.length - 1,
          startLine: contextStartLine,
          endLine: contextEndLine,
          lines: [...currentContext],
        });
        // Update line numbers after context (context lines exist in both files)
        leftLineNumber += currentContext.length;
        currentContext = [];
      }
    };

    const flushDiff = () => {
      if (currentDiff.length > 0) {
        result.push({ type: 'diff', lines: [...currentDiff] });
        currentDiff = [];
      }
    };

    // Convert linear diff into rows for side-by-side and group context
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];

      if (l.type === 'context') {
        // If we have accumulated diff lines, flush them first
        flushDiff();
        // Accumulate context lines
        if (currentContext.length === 0) {
          contextStartIdx = sectionIdx;
          contextStartLine = leftLineNumber; // Track starting line number for this context section
        }
        currentContext.push(l);
        // Context lines exist in both files, so increment line number
        leftLineNumber++;
      } else {
        // If we have accumulated context lines, flush them
        flushContext();

        // Process diff lines
        if (l.type === 'del') {
          currentDiff.push({ left: l });
          leftLineNumber++; // Deleted lines only exist in left file
        } else if (l.type === 'add') {
          // Try to pair with previous deletion if it exists and right is empty
          const last = currentDiff[currentDiff.length - 1];
          if (last && last.right === undefined && last.left && last.left.type === 'del') {
            last.right = l;
          } else {
            currentDiff.push({ right: l });
          }
          // Added lines only exist in right file (don't increment leftLineNumber)
        }
        sectionIdx++;
      }
    }

    // Flush remaining
    flushContext();
    flushDiff();

    return result;
  }, [lines]);

  // Add global styles to override syntax highlighter backgrounds and text shadows
  useEffect(() => {
    if (!open) return;

    const styleId = 'diff-syntax-highlighter-override';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      [data-diff-syntax-highlight] pre,
      [data-diff-syntax-highlight] code,
      [data-diff-syntax-highlight] span {
        background: transparent !important;
        background-color: transparent !important;
        text-shadow: none !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, [open]);

  if (typeof document === 'undefined') {
    return null;
  }
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
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={onClose}
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
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="flex h-[82vh] w-[92vw] transform-gpu overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl will-change-transform dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="w-72 overflow-y-auto border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Changed Files
              </div>
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`w-full border-b border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-gray-700 ${
                    selected === f.path
                      ? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                  onClick={() => switchFile(f.path)}
                >
                  <div className="truncate font-medium">{f.path}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {f.status} • +{f.additions} / -{f.deletions}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-gray-200 bg-white/80 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900/50">
                <div className="truncate text-sm text-gray-700 dark:text-gray-200">{selected}</div>
                <div className="flex items-center gap-2">
                  {!isEditing ? (
                    <button
                      className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900/40"
                      onClick={async () => {
                        if (!selected) return;
                        await loadWorkingCopy(selected);
                        setIsEditing(true);
                      }}
                      title="Edit right side"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  ) : (
                    <>
                      <button
                        className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900/40"
                        onClick={async () => {
                          if (!selected) return;
                          try {
                            const contentToWrite = editorValue.replace(/\n/g, eol);
                            const res = await window.electronAPI.fsWriteFile(
                              workspacePath,
                              selected,
                              contentToWrite,
                              true
                            );
                            if (!res?.success) throw new Error(res?.error || 'Write failed');
                            setDirty(false);
                            setRefreshKey((k) => k + 1);
                            setIsEditing(false);
                            toast({ title: 'Saved', description: selected });
                            if (onRefreshChanges) await onRefreshChanges();
                          } catch (e: any) {
                            toast({
                              title: 'Save failed',
                              description: String(e?.message || e || 'Unable to save file'),
                              variant: 'destructive',
                            });
                          }
                        }}
                        title="Save (⌘/Ctrl+S)"
                      >
                        <Save className="h-3.5 w-3.5" /> Save
                      </button>
                      <button
                        className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900/40"
                        onClick={async () => {
                          if (!selected) return;
                          await loadWorkingCopy(selected);
                          setDirty(false);
                        }}
                        title="Discard local edits"
                      >
                        <Undo2 className="h-3.5 w-3.5" /> Discard
                      </button>
                    </>
                  )}
                  <button
                    onClick={onClose}
                    className="rounded-md p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                    Loading diff…
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-px bg-gray-200 dark:bg-gray-800">
                    <div className="bg-white dark:bg-gray-900">
                      {sections.map((section, sectionIdx) => {
                        if (section.type === 'context') {
                          const isExpanded = expandedSections.has(sectionIdx);
                          const lineCount = section.lines.length;
                          const lineRange =
                            section.startLine === section.endLine
                              ? `${section.startLine}`
                              : `${section.startLine}-${section.endLine}`;

                          return (
                            <div key={`context-l-${sectionIdx}`}>
                              <button
                                onClick={() => {
                                  const newExpanded = new Set(expandedSections);
                                  if (isExpanded) {
                                    newExpanded.delete(sectionIdx);
                                  } else {
                                    newExpanded.add(sectionIdx);
                                  }
                                  setExpandedSections(newExpanded);
                                }}
                                className="w-full border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:bg-gray-800"
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} context lines ${lineRange}`}
                              >
                                <div className="flex items-center gap-2">
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                  <span>
                                    {isExpanded ? 'Collapse' : 'Expand'} ({lineCount}) - Lines{' '}
                                    {lineRange}
                                  </span>
                                </div>
                              </button>
                              {/* Context lines */}
                              {isExpanded &&
                                section.lines.map((l, idx) => (
                                  <HighlightedLine
                                    key={`context-l-${sectionIdx}-${idx}`}
                                    text={l.left || l.right || ''}
                                    type="context"
                                    language={language}
                                    isDark={isDark}
                                  />
                                ))}
                            </div>
                          );
                        } else {
                          return (
                            <React.Fragment key={`diff-l-${sectionIdx}`}>
                              {section.lines.map((r, idx) => (
                                <HighlightedLine
                                  key={`diff-l-${sectionIdx}-${idx}`}
                                  text={r.left?.left ?? r.left?.right ?? ''}
                                  type={r.left?.type || 'context'}
                                  language={language}
                                  isDark={isDark}
                                />
                              ))}
                            </React.Fragment>
                          );
                        }
                      })}
                    </div>

                    <div className="bg-white dark:bg-gray-900">
                      {!isEditing ? (
                        sections.map((section, sectionIdx) => {
                          if (section.type === 'context') {
                            const isExpanded = expandedSections.has(sectionIdx);
                            const lineCount = section.lines.length;
                            const lineRange =
                              section.startLine === section.endLine
                                ? `${section.startLine}`
                                : `${section.startLine}-${section.endLine}`;

                            return (
                              <div key={`context-r-${sectionIdx}`}>
                                {/* Collapsible header */}
                                <button
                                  onClick={() => {
                                    const newExpanded = new Set(expandedSections);
                                    if (isExpanded) {
                                      newExpanded.delete(sectionIdx);
                                    } else {
                                      newExpanded.add(sectionIdx);
                                    }
                                    setExpandedSections(newExpanded);
                                  }}
                                  className="w-full border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:bg-gray-800"
                                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} context lines ${lineRange}`}
                                >
                                  <div className="flex items-center gap-2">
                                    {isExpanded ? (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    )}
                                    <span>
                                      {isExpanded ? 'Collapse' : 'Expand'} ({lineCount}) - Lines{' '}
                                      {lineRange}
                                    </span>
                                  </div>
                                </button>
                                {/* Context lines */}
                                {isExpanded &&
                                  section.lines.map((l, idx) => (
                                    <HighlightedLine
                                      key={`context-r-${sectionIdx}-${idx}`}
                                      text={l.right || l.left || ''}
                                      type="context"
                                      language={language}
                                      isDark={isDark}
                                    />
                                  ))}
                              </div>
                            );
                          } else {
                            // Diff lines
                            return (
                              <React.Fragment key={`diff-r-${sectionIdx}`}>
                                {section.lines.map((r, idx) => (
                                  <HighlightedLine
                                    key={`diff-r-${sectionIdx}-${idx}`}
                                    text={r.right?.right ?? r.right?.left ?? ''}
                                    type={r.right?.type || 'context'}
                                    language={language}
                                    isDark={isDark}
                                  />
                                ))}
                              </React.Fragment>
                            );
                          }
                        })
                      ) : editorLoading ? (
                        <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                          Loading file…
                        </div>
                      ) : (
                        <div className="relative h-full w-full overflow-hidden">
                          <div
                            ref={highlightRef}
                            className="pointer-events-none absolute inset-0 overflow-auto p-3"
                            data-diff-syntax-highlight
                          >
                            <SyntaxHighlighter
                              language={language}
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
                          {/* Editable textarea overlay */}
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
                            onKeyDown={async (e) => {
                              const isMeta = e.metaKey || e.ctrlKey;
                              if (isMeta && e.key.toLowerCase() === 's') {
                                e.preventDefault();
                                try {
                                  const contentToWrite = editorValue.replace(/\n/g, eol);
                                  const res = await window.electronAPI.fsWriteFile(
                                    workspacePath,
                                    selected!,
                                    contentToWrite,
                                    true
                                  );
                                  if (!res?.success) throw new Error(res?.error || 'Write failed');
                                  setDirty(false);
                                  setRefreshKey((k) => k + 1);
                                  setIsEditing(false);
                                  toast({ title: 'Saved', description: selected! });
                                  if (onRefreshChanges) await onRefreshChanges();
                                } catch (err: any) {
                                  toast({
                                    title: 'Save failed',
                                    description: String(err?.message || 'Unable to save file'),
                                    variant: 'destructive',
                                  });
                                }
                              }
                              if (e.key === 'Escape') {
                                if (
                                  !dirty ||
                                  window.confirm('Discard unsaved changes and exit edit?')
                                ) {
                                  setIsEditing(false);
                                  setDirty(false);
                                }
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ChangesDiffModal;
