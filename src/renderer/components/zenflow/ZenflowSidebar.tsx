import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, PauseCircle, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanStepData, ZenflowWorkflowStatus } from '@shared/zenflow/types';
import ZenflowStepRow from './ZenflowStepRow';

const STORAGE_KEY = 'emdash:zenflow-sidebar-collapsed';

interface ZenflowSidebarProps {
  steps: PlanStepData[];
  workflowStatus: ZenflowWorkflowStatus | null;
  autoStartSteps: boolean;
  onAutoStartChange: (enabled: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onStartStep: (stepId: string) => void;
  onRetryStep: (stepId: string) => void;
  onStepClick: (conversationId: string) => void;
  taskId: string;
  taskPath?: string;
}

const ZenflowSidebar: React.FC<ZenflowSidebarProps> = ({
  steps,
  workflowStatus,
  autoStartSteps,
  onAutoStartChange,
  onPause,
  onResume,
  onStartStep,
  onRetryStep,
  onStepClick,
  taskId,
  taskPath,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Listen for active conversation changes from ChatInterface
  useEffect(() => {
    const handler = (e: Event) => {
      const convId = (e as CustomEvent).detail?.conversationId;
      if (convId) setActiveConversationId(convId);
    };
    window.addEventListener('zenflow:active-conversation-changed', handler);
    return () => window.removeEventListener('zenflow:active-conversation-changed', handler);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const nextPendingStep = steps.find((s) => s.status === 'pending');

  const handleEditPlan = useCallback(() => {
    if (taskPath) {
      const filePath = `${taskPath}/.zenflow/plan.md`;
      window.electronAPI?.openExternal?.(`file://${filePath}`).catch(() => {});
    }
  }, [taskPath]);

  // Collapsed pill view
  if (collapsed) {
    return (
      <div className="flex h-full w-8 flex-col items-center border-r border-border bg-card py-2">
        <button
          onClick={toggleCollapsed}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Expand steps panel"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        {/* Vertical progress dots */}
        <div className="mt-3 flex flex-col items-center gap-1">
          {steps.map((step) => (
            <div
              key={step.stepNumber}
              className={cn(
                'h-2 w-2 rounded-full',
                step.status === 'completed' && 'bg-green-500',
                step.status === 'running' && 'bg-blue-500',
                step.status === 'failed' && 'bg-red-500',
                step.status === 'pending' && 'bg-muted-foreground/30',
                step.status === 'paused' && 'bg-yellow-500'
              )}
            />
          ))}
        </div>

        {/* Rotated count */}
        <span
          className="mt-3 text-[10px] text-muted-foreground"
          style={{ writingMode: 'vertical-lr' }}
        >
          {completedCount}/{steps.length}
        </span>
      </div>
    );
  }

  // Expanded view
  return (
    <div className="flex h-full w-52 flex-col border-r border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">Steps</span>
        <button
          onClick={toggleCollapsed}
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Collapse steps panel"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <button
          onClick={handleEditPlan}
          className="flex items-center gap-1 text-[10px] text-blue-500 hover:underline"
        >
          <FileText className="h-3 w-3" />
          Edit plan.md
        </button>

        {/* Auto-start toggle */}
        <label className="flex cursor-pointer items-center gap-1">
          <span className="text-[10px] text-muted-foreground">Auto-start</span>
          <button
            role="switch"
            aria-checked={autoStartSteps}
            onClick={() => onAutoStartChange(!autoStartSteps)}
            className={cn(
              'relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors',
              autoStartSteps ? 'bg-blue-500' : 'bg-muted-foreground/30'
            )}
          >
            <span
              className={cn(
                'inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform',
                autoStartSteps ? 'translate-x-3' : 'translate-x-0.5'
              )}
            />
          </button>
        </label>
      </div>

      {/* Step list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {steps.map((step) => (
          <ZenflowStepRow
            key={step.stepNumber}
            step={step}
            isActive={step.conversationId === activeConversationId}
            isNextPending={step === nextPendingStep}
            onClick={() => {
              if (step.conversationId) onStepClick(step.conversationId);
            }}
            onStart={() => onStartStep(`step-${taskId}-${step.stepNumber}`)}
            onRetry={() => onRetryStep(`step-${taskId}-${step.stepNumber}`)}
          />
        ))}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-border px-3 py-2">
        {workflowStatus === 'running' && (
          <button
            onClick={onPause}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <PauseCircle className="h-3 w-3" />
            Pause
          </button>
        )}
        {(workflowStatus === 'paused' || workflowStatus === 'failed') && (
          <button
            onClick={onResume}
            className="flex w-full items-center justify-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-500 transition-colors hover:bg-blue-500/20"
          >
            <Play className="h-3 w-3" />
            Resume
          </button>
        )}
        {workflowStatus === 'completed' && (
          <div className="text-center text-[10px] text-green-500">All steps completed</div>
        )}
      </div>
    </div>
  );
};

export default ZenflowSidebar;
