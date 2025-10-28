import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Save, Undo2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useFileDiff, type DiffLine } from '../hooks/useFileDiff';
import { type FileChange } from '../hooks/useFileChanges';
import { useToast } from '../hooks/use-toast';

interface ChangesDiffModalProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  files: FileChange[];
  initialFile?: string;
  onRefreshChanges?: () => Promise<void> | void;
}

const Line: React.FC<{ text?: string; type: DiffLine['type'] }> = ({ text = '', type }) => {
  const cls =
    type === 'add'
      ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200'
      : type === 'del'
        ? 'bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200'
        : 'bg-transparent text-gray-700 dark:text-gray-300';
  return (
    <div
      className={`whitespace-pre-wrap break-words px-3 py-0.5 font-mono text-[12px] leading-5 ${cls}`}
    >
      {text}
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

  // Inline edit mode state (right pane)
  const [isEditing, setIsEditing] = useState(false);
  const [editorValue, setEditorValue] = useState<string>('');
  const [editorLoading, setEditorLoading] = useState<boolean>(false);
  const [dirty, setDirty] = useState<boolean>(false);
  const [eol, setEol] = useState<'\n' | '\r\n'>('\n');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  const grouped = useMemo(() => {
    // Convert linear diff into rows for side-by-side
    const rows: Array<{ left?: DiffLine; right?: DiffLine }> = [];
    for (const l of lines) {
      if (l.type === 'context') {
        rows.push({
          left: { ...l, left: l.left, right: undefined },
          right: { ...l, right: l.right, left: undefined },
        });
      } else if (l.type === 'del') {
        rows.push({ left: l });
      } else if (l.type === 'add') {
        // Try to pair with previous deletion if it exists and right is empty
        const last = rows[rows.length - 1];
        if (last && last.right === undefined && last.left && last.left.type === 'del') {
          last.right = l;
        } else {
          rows.push({ right: l });
        }
      }
    }
    return rows;
  }, [lines]);

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
                      {grouped.map((r, idx) => (
                        <Line
                          key={`l-${idx}`}
                          text={r.left?.left ?? r.left?.right}
                          type={r.left?.type || 'context'}
                        />
                      ))}
                    </div>
                    <div className="bg-white dark:bg-gray-900">
                      {!isEditing ? (
                        grouped.map((r, idx) => (
                          <Line
                            key={`r-${idx}`}
                            text={r.right?.right ?? r.right?.left}
                            type={r.right?.type || 'context'}
                          />
                        ))
                      ) : editorLoading ? (
                        <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                          Loading file…
                        </div>
                      ) : (
                        <textarea
                          ref={textareaRef}
                          className="h-full w-full resize-none bg-white p-3 font-mono text-[12px] leading-5 text-gray-800 outline-none dark:bg-gray-900 dark:text-gray-100"
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
                              // Exit edit mode (prompt if dirty)
                              if (!dirty || window.confirm('Discard unsaved changes and exit edit?')) {
                                setIsEditing(false);
                                setDirty(false);
                              }
                            }
                          }}
                        />
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
