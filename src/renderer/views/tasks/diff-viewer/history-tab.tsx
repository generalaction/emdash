import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CommitFileListSection } from './commit-file-list';
import { CommitListSection } from './commit-list-section';
import { useDiffViewContext } from './diff-view-provider';

export function HistoryTab() {
  const { selectedCommit, setSelectedCommit } = useDiffViewContext();
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset expanded state when commit changes
  useEffect(() => {
    setDetailExpanded(false);
    setCopied(false);
  }, [selectedCommit?.hash]);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const handleCopyHash = async () => {
    if (!selectedCommit) return;
    try {
      await navigator.clipboard.writeText(selectedCommit.hash);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API not available
    }
  };

  const bodyTrimmed = selectedCommit?.body?.trim() || '';
  const hasExpandableContent = bodyTrimmed.length > 0 || !!selectedCommit?.author;

  return (
    <div className="flex h-full flex-col">
      {/* Commit list — scrollable upper section */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CommitListSection />
      </div>

      {/* Commit detail + file list — capped lower section so the list above stays scrollable */}
      {selectedCommit && (
        <div className="flex max-h-[40%] flex-col border-t border-border">
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1 truncate text-sm font-medium leading-snug">
                {selectedCommit.subject}
              </div>
              {hasExpandableContent && (
                <button
                  className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setDetailExpanded((prev) => !prev)}
                >
                  {detailExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
            {detailExpanded && (
              <div className="mt-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{selectedCommit.author}</span>
                  <button
                    className="flex items-center gap-1 rounded px-1 py-0.5 font-mono hover:bg-muted hover:text-foreground"
                    onClick={() => void handleCopyHash()}
                    title="Copy commit hash"
                  >
                    {selectedCommit.hash.slice(0, 7)}
                    {copied ? (
                      <Check className="h-3 w-3 text-green-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                </div>
                {bodyTrimmed && (
                  <div className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {bodyTrimmed}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CommitFileListSection commitHash={selectedCommit.hash} />
          </div>
        </div>
      )}
    </div>
  );
}
