import React, { useState } from "react";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { useToast } from "../hooks/use-toast";
import { useCreatePR } from "../hooks/useCreatePR";
import ChangesDiffModal from "./ChangesDiffModal";
import { useFileChanges, type FileChange } from "../hooks/useFileChanges";
import { usePrStatus } from "../hooks/usePrStatus";
import PrStatusSkeleton from "./ui/pr-status-skeleton";
import FileTypeIcon from "./ui/file-type-icon";

interface FileChangesPanelProps {
  workspaceId: string;
  className?: string;
}

export const FileChangesPanel: React.FC<FileChangesPanelProps> = ({
  workspaceId,
  className,
}) => {
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    undefined
  );
  const { isCreating: isCreatingPR, createPR } = useCreatePR();
  const { fileChanges, isLoading, error, refreshChanges } =
    useFileChanges(workspaceId);
  const { toast } = useToast();
  const hasChanges = fileChanges.length > 0;
  const { pr, loading: prLoading, refresh: refreshPr } = usePrStatus(workspaceId);

  const renderPath = (p: string) => {
    const last = p.lastIndexOf("/");
    const dir = last >= 0 ? p.slice(0, last + 1) : "";
    const base = last >= 0 ? p.slice(last + 1) : p;
    return (
      <span className="truncate">
        {dir && <span className="text-gray-500 dark:text-gray-400">{dir}</span>}
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          {base}
        </span>
      </span>
    );
  };

  const totalChanges = fileChanges.reduce(
    (acc, change) => ({
      additions: acc.additions + change.additions,
      deletions: acc.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 }
  );

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-2xl shadow-lg flex flex-col h-full overflow-hidden ${className}`}
    >
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center">
        {hasChanges ? (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center space-x-2">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium p-2 text-gray-900 dark:text-gray-100">
                  {fileChanges.length} files changed
                </span>
                <div className="flex items-center space-x-1">
                  <div className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded-lg">
                    <span className="text-green-600 dark:text-green-400 font-semibold text-xs">
                      +{totalChanges.additions}
                    </span>
                    <span className="text-gray-400 mx-1">•</span>
                    <span className="text-red-600 dark:text-red-400 font-semibold text-xs">
                      -{totalChanges.deletions}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                disabled={isCreatingPR}
                onClick={async () => {
                  await createPR({
                    workspacePath: workspaceId,
                    onSuccess: async () => {
                      await refreshChanges();
                      try { await refreshPr(); } catch {}
                    },
                  });
                }}
              >
                {isCreatingPR ? <Spinner size="sm" /> : "Create PR"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 p-2">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Changes
              </span>
            </div>
            <div className="flex items-center gap-2">
              {prLoading ? (
                <PrStatusSkeleton />
              ) : pr ? (
                <button
                  type="button"
                  onClick={() => {
                    const api: any = (window as any).electronAPI;
                    api?.openExternal?.(pr.url);
                  }}
                  className={`cursor-pointer text-[11px] px-2 py-0.5 rounded border 
                    ${pr.state === 'MERGED' ? 'bg-gray-100 text-gray-700 border-gray-200' : ''}
                    ${pr.state === 'OPEN' && pr.isDraft ? 'bg-gray-100 text-gray-700 border-gray-200' : ''}
                    ${pr.state === 'OPEN' && !pr.isDraft ? 'bg-gray-100 text-gray-700 border-gray-200' : ''}
                    ${pr.state === 'CLOSED' ? 'bg-gray-100 text-gray-700 border-gray-200' : ''}
                  `}
                  title={pr.title || 'Pull Request'}
                >
                  PR {pr.isDraft ? 'draft' : pr.state.toLowerCase()}
                </button>
              ) : (
                <span className="text-xs text-gray-500">No PR for this branch</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {fileChanges.map((change, index) => (
          <div
            key={index}
            className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700 last:border-b-0 cursor-pointer transition-colors"
            onClick={() => {
              setSelectedPath(change.path);
              setShowDiffModal(true);
            }}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <span className="inline-flex items-center justify-center w-4 h-4 text-gray-500">
                <FileTypeIcon
                  path={change.path}
                  type={change.status === "deleted" ? "file" : "file"}
                  size={14}
                />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">
                  {renderPath(change.path)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-3">
              {change.additions > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-900/30 text-emerald-700 dark:text-emerald-300 text-[11px] font-medium">
                  +{change.additions}
                </span>
              )}
              {change.deletions > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-[11px] font-medium">
                  -{change.deletions}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {showDiffModal && (
        <ChangesDiffModal
          open={showDiffModal}
          onClose={() => setShowDiffModal(false)}
          workspacePath={workspaceId}
          files={fileChanges}
          initialFile={selectedPath}
        />
      )}
    </div>
  );
};

export default FileChangesPanel;
