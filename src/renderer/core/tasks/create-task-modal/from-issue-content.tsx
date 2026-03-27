import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Branch } from '@shared/git';
import { InlineIssueSelector } from '@renderer/components/inline-issue-selector';
import { SelectedIssueValue } from '@renderer/components/issue-selector';
import { BranchPickerField } from './branch-picker-field';
import { TaskNameField } from './task-name-field';
import { FromIssueModeState } from './use-from-issue-mode';

interface FromIssueContentProps {
  state: FromIssueModeState;
  branches: Branch[];
  nameWithOwner?: string;
}

function AnimatedHeight({ children }: { children: React.ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      animate={{ height: height ?? 'auto' }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
      className="w-full overflow-hidden"
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
}

export function FromIssueContent({ state, branches, nameWithOwner = '' }: FromIssueContentProps) {
  const [isSelecting, setIsSelecting] = useState(!state.linkedIssue);

  const handleValueChange = (issue: Parameters<typeof state.setLinkedIssue>[0]) => {
    state.setLinkedIssue(issue);
    if (issue) setIsSelecting(false);
  };

  const handleDeselect = () => {
    state.setLinkedIssue(null);
    setIsSelecting(true);
  };

  return (
    <>
      <AnimatedHeight>
        {isSelecting || !state.linkedIssue ? (
          <InlineIssueSelector
            value={state.linkedIssue}
            onValueChange={handleValueChange}
            nameWithOwner={nameWithOwner}
          />
        ) : (
          <div className="rounded-md border border-border flex flex-col gap-2">
            <div className="flex flex-col gap-2 p-2">
              <SelectedIssueValue issue={state.linkedIssue!} onRemove={handleDeselect} />
            </div>
            <div className="flex items-center justify-between h-6 px-2 text-xs bg-background-1 border-t border-border">
              <div className="text-foreground-muted"></div>
              <div className="text-foreground-muted">
                <button className="flex items-center gap-2" onClick={() => setIsSelecting(true)}>
                  Select another Issue
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatedHeight>
      <BranchPickerField state={state} branches={branches} />
      <TaskNameField state={state} />
    </>
  );
}
