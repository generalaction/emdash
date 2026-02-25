import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { useFileChanges } from '../../hooks/useFileChanges';
import { ChangesTab } from './ChangesTab';
import { HistoryTab } from './HistoryTab';

interface DiffViewerProps {
  open: boolean;
  onClose: () => void;
  taskId?: string;
  taskPath?: string;
  projectPath?: string;
}

type Tab = 'changes' | 'history';

export const DiffViewer: React.FC<DiffViewerProps> = ({
  open,
  onClose,
  taskId,
  taskPath,
  projectPath,
}) => {
  const [activeTab, setActiveTab] = useState<Tab>('changes');
  const shouldReduceMotion = useReducedMotion();
  const { fileChanges, refreshChanges } = useFileChanges(taskPath);
  const fileCount = fileChanges.length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[50] flex flex-col bg-background"
          initial={shouldReduceMotion ? { opacity: 0 } : { x: '-100%' }}
          animate={shouldReduceMotion ? { opacity: 1 } : { x: 0 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { x: '-100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Tab bar */}
          <div className="flex items-center border-b border-border bg-muted/50">
            <div className="flex flex-1 items-center">
              <button
                onClick={() => setActiveTab('changes')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'changes'
                    ? 'border-b-2 border-foreground text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Changes{fileCount > 0 ? ` (${fileCount})` : ''}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'history'
                    ? 'border-b-2 border-foreground text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                History
              </button>
            </div>
            <button
              onClick={onClose}
              className="mr-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close diff viewer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tab content */}
          <div className="min-h-0 flex-1 overflow-auto">
            {activeTab === 'changes' ? (
              <ChangesTab
                taskId={taskId}
                taskPath={taskPath}
                fileChanges={fileChanges}
                onRefreshChanges={refreshChanges}
              />
            ) : (
              <HistoryTab taskPath={taskPath} />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
