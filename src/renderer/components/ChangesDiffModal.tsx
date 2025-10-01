import React, { useState, useEffect } from "react";
import { X, LayoutPanelLeft, LayoutPanelTop } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { Button } from "./ui/button";
import { type FileChange } from "../hooks/useFileChanges";

interface ChangesDiffModalProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  files: FileChange[];
  initialFile?: string;
}

const ChangesDiffModal: React.FC<ChangesDiffModalProps> = ({
  open,
  onClose,
  workspacePath,
  files,
  initialFile,
}) => {
  const [selected, setSelected] = useState<string | undefined>(
    initialFile || files[0]?.path
  );
  const [splitView, setSplitView] = useState(true);
  const [oldValue, setOldValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [loading, setLoading] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  // Fetch file diff content
  useEffect(() => {
    if (!selected || !workspacePath) return;

    const fetchDiff = async () => {
      setLoading(true);
      try {
        console.log('[Diff Modal] Fetching diff for:', selected, 'in workspace:', workspacePath);

        // Get the current file content using existing fsRead API
        const currentResult = await window.electronAPI.fsRead(
          workspacePath,
          selected
        );
        console.log('[Diff Modal] Current file result:', currentResult);

        // Get the original file content from git using existing diff API
        const diffResult = await window.electronAPI.getFileDiff({
          workspacePath,
          filePath: selected
        });
        console.log('[Diff Modal] Diff result:', diffResult);

        // Extract content from the results
        const newContent = currentResult.success ? currentResult.content || "" : "";

        // Reconstruct both old and new content from diff lines
        let oldContent = "";
        let newContentFromDiff = "";

        if (diffResult.success && diffResult.diff?.lines) {
          const lines = diffResult.diff.lines;

          // Reconstruct original content (context + deleted lines)
          oldContent = lines
            .filter(line => line.type === 'context' || line.type === 'del')
            .map(line => line.left || line.right || "")
            .join('\n');

          // Reconstruct new content (context + added lines)
          newContentFromDiff = lines
            .filter(line => line.type === 'context' || line.type === 'add')
            .map(line => line.right || line.left || "")
            .join('\n');
        }

        // Use the current file content if available, otherwise use reconstructed content
        const finalNewContent = (currentResult.success && currentResult.content)
          ? currentResult.content
          : newContentFromDiff;

        setOldValue(oldContent);
        setNewValue(finalNewContent);
      } catch (error) {
        console.error("Failed to fetch diff:", error);
        setOldValue("");
        setNewValue("");
      } finally {
        setLoading(false);
      }
    };

    fetchDiff();
  }, [selected, workspacePath]);

  const diffViewerStyles = {
    variables: {
      dark: {
        codeFoldGutterBackground: '#374151',
        codeFoldBackground: '#1f2937',
        gutterBackground: '#374151',
        gutterBackgroundDark: '#1f2937',
        highlightBackground: '#065f46',
        highlightGutterBackground: '#064e3b',
        addedBackground: '#dcfce7',
        addedColor: '#166534',
        removedBackground: '#fef2f2',
        removedColor: '#dc2626',
        wordAddedBackground: '#bbf7d0',
        wordRemovedBackground: '#fecaca',
        addedGutterBackground: '#16a34a',
        removedGutterBackground: '#dc2626',
        gutterColor: '#9ca3af',
        addedGutterColor: '#ffffff',
        removedGutterColor: '#ffffff',
        codeFoldContentColor: '#9ca3af',
        diffViewerBackground: '#111827',
        diffViewerColor: '#f3f4f6',
        emptyLineBackground: '#1f2937',
      },
      light: {
        codeFoldGutterBackground: '#f3f4f6',
        codeFoldBackground: '#f9fafb',
        gutterBackground: '#f3f4f6',
        gutterBackgroundDark: '#e5e7eb',
        highlightBackground: '#fef3c7',
        highlightGutterBackground: '#f59e0b',
        addedBackground: '#dcfce7',
        addedColor: '#166534',
        removedBackground: '#fef2f2',
        removedColor: '#dc2626',
        wordAddedBackground: '#bbf7d0',
        wordRemovedBackground: '#fecaca',
        addedGutterBackground: '#16a34a',
        removedGutterBackground: '#dc2626',
        gutterColor: '#6b7280',
        addedGutterColor: '#ffffff',
        removedGutterColor: '#ffffff',
        codeFoldContentColor: '#6b7280',
        diffViewerBackground: '#ffffff',
        diffViewerColor: '#374151',
        emptyLineBackground: '#f9fafb',
      }
    },
    line: {
      fontSize: '11px',
      lineHeight: '16px',
    },
    marker: {
      fontSize: '10px',
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { duration: 0.1, ease: "easeOut" }
          }
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={
              shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 6, scale: 0.995 }
            }
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="w-[92vw] h-[82vh] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex will-change-transform transform-gpu"
          >
            {/* File List Sidebar */}
            <div className="w-72 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 overflow-y-auto">
              <div className="px-4 py-3 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-semibold border-b border-gray-200 dark:border-gray-700">
                Changed Files
              </div>
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`w-full text-left px-4 py-3 text-sm border-b border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                    selected === f.path
                      ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                  onClick={() => setSelected(f.path)}
                >
                  <div className="truncate font-medium">{f.path}</div>
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <span className="uppercase font-medium">{f.status}</span>
                    <span>•</span>
                    <span className="text-green-600 dark:text-green-400">+{f.additions}</span>
                    <span className="text-red-600 dark:text-red-400">-{f.deletions}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Diff Viewer */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Header with file name and controls */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/50">
                <div className="flex items-center gap-3">
                  <div className="text-sm text-gray-700 dark:text-gray-200 truncate font-medium">
                    {selected}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSplitView(!splitView)}
                      className="h-7 px-2 rounded-lg"
                      title={splitView ? "Switch to unified view" : "Switch to side-by-side view"}
                    >
                      {splitView ? (
                        <LayoutPanelTop className="w-3 h-3" />
                      ) : (
                        <LayoutPanelLeft className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Diff Content */}
              <div className="flex-1 overflow-hidden">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                      Loading diff…
                    </div>
                  </div>
                ) : (
                  <ReactDiffViewer
                    oldValue={oldValue}
                    newValue={newValue}
                    splitView={splitView}
                    compareMethod={DiffMethod.CHARS}
                    styles={diffViewerStyles}
                    leftTitle="Original"
                    rightTitle="Modified"
                    hideLineNumbers={false}
                    showDiffStats={true}
                    useDarkTheme={document.documentElement.classList.contains('dark')}
                  />
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ChangesDiffModal;