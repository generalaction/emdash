import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useFileDiff, type DiffLine } from "../hooks/useFileDiff";
import { type FileChange } from "../hooks/useFileChanges";

interface ChangesDiffModalProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  files: FileChange[];
  initialFile?: string;
}

const Line: React.FC<{ text?: string; type: DiffLine["type"] }> = ({
  text = "",
  type,
}) => {
  const cls =
    type === "add"
      ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200"
      : type === "del"
        ? "bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200"
        : "bg-transparent text-gray-700 dark:text-gray-300";
  return (
    <div
      className={`px-3 py-0.5 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 ${cls}`}
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
}) => {
  const [selected, setSelected] = useState<string | undefined>(
    initialFile || files[0]?.path,
  );
  const { lines, loading } = useFileDiff(workspacePath, selected, {
    enabled: open,
  });
  const shouldReduceMotion = useReducedMotion();

  const grouped = useMemo(() => {
    // Convert linear diff into rows for side-by-side
    const rows: Array<{ left?: DiffLine; right?: DiffLine }> = [];
    for (const l of lines) {
      if (l.type === "context") {
        rows.push({
          left: { ...l, left: l.left, right: undefined },
          right: { ...l, right: l.right, left: undefined },
        });
      } else if (l.type === "del") {
        rows.push({ left: l });
      } else if (l.type === "add") {
        // Try to pair with previous deletion if it exists and right is empty
        const last = rows[rows.length - 1];
        if (
          last &&
          last.right === undefined &&
          last.left &&
          last.left.type === "del"
        ) {
          last.right = l;
        } else {
          rows.push({ right: l });
        }
      }
    }
    return rows;
  }, [lines]);

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
            className="w-[92vw] h-[82vh] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden flex will-change-transform transform-gpu"
          >
            <div className="w-72 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 overflow-y-auto">
              <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Changed Files
              </div>
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    selected === f.path
                      ? "bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      : "text-gray-700 dark:text-gray-300"
                  }`}
                  onClick={() => setSelected(f.path)}
                >
                  <div className="truncate font-medium">{f.path}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {f.status} • +{f.additions} / -{f.deletions}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/50">
                <div className="text-sm text-gray-700 dark:text-gray-200 truncate">
                  {selected}
                </div>
                <button
                  onClick={onClose}
                  className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-auto">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
                    Loading diff…
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-px bg-gray-200 dark:bg-gray-800">
                    <div className="bg-white dark:bg-gray-900">
                      {grouped.map((r, idx) => (
                        <Line
                          key={`l-${idx}`}
                          text={r.left?.left ?? r.left?.right}
                          type={r.left?.type || "context"}
                        />
                      ))}
                    </div>
                    <div className="bg-white dark:bg-gray-900">
                      {grouped.map((r, idx) => (
                        <Line
                          key={`r-${idx}`}
                          text={r.right?.right ?? r.right?.left}
                          type={r.right?.type || "context"}
                        />
                      ))}
                    </div>
                  </div>
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
