import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PlanDocument,
  PlanStepData,
  ZenflowEvent,
  ZenflowWorkflowStatus,
} from '@shared/zenflow/types';
import type { Task } from '../types/chat';

export interface UseZenflowWorkflowResult {
  /** Steps parsed from plan.md */
  planSteps: PlanStepData[];
  /** Derived workflow status */
  workflowStatus: ZenflowWorkflowStatus | null;
  /** Whether initial load is in progress */
  loading: boolean;
  /** Check if a conversation belongs to a zenflow step */
  isZenflowStep: (conversationId: string) => boolean;
  /** Get the step data for a conversation */
  getStepForConversation: (conversationId: string) => PlanStepData | null;
  /** Get the step prompt for a conversation (for initial injection) */
  getStepPrompt: (conversationId: string) => string | null;
  /** Resume a paused workflow */
  resume: () => Promise<void>;
  /** Pause the workflow */
  pause: () => Promise<void>;
  /** Retry a failed step */
  retryStep: (stepId: string) => Promise<void>;
}

/** Derive workflow status from step statuses */
function deriveWorkflowStatus(steps: PlanStepData[]): ZenflowWorkflowStatus | null {
  if (steps.length === 0) return null;
  if (steps.some((s) => s.status === 'running')) return 'running';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  if (steps.every((s) => s.status === 'completed')) return 'completed';
  if (steps.some((s) => s.status === 'paused')) return 'paused';
  // Mix of completed and pending = paused (waiting for user to continue)
  if (steps.some((s) => s.status === 'completed') && steps.some((s) => s.status === 'pending'))
    return 'paused';
  return null;
}

export function useZenflowWorkflow(task: Task): UseZenflowWorkflowResult {
  const [planSteps, setPlanSteps] = useState<PlanStepData[]>([]);
  const [loading, setLoading] = useState(true);
  const taskIdRef = useRef(task.id);
  taskIdRef.current = task.id;

  // Keep a map of conversationId → step for lookups + prompts from DB
  const stepMapRef = useRef(new Map<string, PlanStepData>());
  const stepPromptsRef = useRef(new Map<string, string>());

  const workflowStatus = deriveWorkflowStatus(planSteps);

  // Load plan.md and step prompts on mount
  useEffect(() => {
    const loadPlan = async () => {
      setLoading(true);
      try {
        // Read plan.md (source of truth for step state)
        if (task.path) {
          const result = await window.electronAPI.zenflowReadPlan(task.path);
          if (result.success && result.data) {
            setPlanSteps(result.data.steps);
            updateStepMap(result.data.steps);
          }
        }

        // Load step prompts from DB (prompts aren't in plan.md to keep it clean)
        const stepsResult = await window.electronAPI.zenflowGetSteps(task.id);
        if (stepsResult.success && stepsResult.data) {
          const promptMap = new Map<string, string>();
          for (const row of stepsResult.data) {
            if (row.conversationId && row.prompt) {
              promptMap.set(row.conversationId, row.prompt);
            }
          }
          stepPromptsRef.current = promptMap;
        }
      } catch (err) {
        console.error('Failed to load zenflow plan', err);
      } finally {
        setLoading(false);
      }
    };

    loadPlan();

    // Start watching plan.md for changes
    if (task.path) {
      window.electronAPI.zenflowWatchPlan({ taskId: task.id, worktreePath: task.path });
    }

    return () => {
      window.electronAPI.zenflowUnwatchPlan(task.id);
    };
  }, [task.id, task.path]);

  // Subscribe to plan.md file changes
  useEffect(() => {
    const cleanup = window.electronAPI.onZenflowPlanChanged(
      (data: { taskId: string; plan: PlanDocument }) => {
        if (data.taskId !== taskIdRef.current) return;
        setPlanSteps(data.plan.steps);
        updateStepMap(data.plan.steps);
      }
    );

    return cleanup;
  }, [task.id]);

  // Also subscribe to zenflow IPC events for immediate status changes
  // (plan.md file watcher has 500ms debounce, events are instant)
  useEffect(() => {
    const cleanup = window.electronAPI.onZenflowEvent((event: ZenflowEvent) => {
      if (event.taskId !== taskIdRef.current) return;

      // On step-started, switch to that conversation's tab
      if (event.type === 'step-started' && event.conversationId) {
        // Dispatch custom event for ChatInterface to pick up and switch tab
        window.dispatchEvent(
          new CustomEvent('zenflow:switch-to-conversation', {
            detail: { conversationId: event.conversationId },
          })
        );
      }

      // Refresh plan from file for definitive state
      if (task.path) {
        window.electronAPI.zenflowReadPlan(task.path).then((result) => {
          if (result.success && result.data) {
            setPlanSteps(result.data.steps);
            updateStepMap(result.data.steps);
          }
        });
      }
    });

    return cleanup;
  }, [task.id, task.path]);

  function updateStepMap(steps: PlanStepData[]) {
    const map = new Map<string, PlanStepData>();
    for (const step of steps) {
      if (step.conversationId) {
        map.set(step.conversationId, step);
      }
    }
    stepMapRef.current = map;
  }

  const isZenflowStep = useCallback((conversationId: string) => {
    return stepMapRef.current.has(conversationId);
  }, []);

  const getStepForConversation = useCallback((conversationId: string) => {
    return stepMapRef.current.get(conversationId) ?? null;
  }, []);

  const getStepPrompt = useCallback((conversationId: string) => {
    return stepPromptsRef.current.get(conversationId) ?? null;
  }, []);

  const resume = useCallback(async () => {
    await window.electronAPI.zenflowResumeWorkflow(task.id);
  }, [task.id]);

  const pause = useCallback(async () => {
    await window.electronAPI.zenflowPauseWorkflow(task.id);
  }, [task.id]);

  const retryStep = useCallback(async (stepId: string) => {
    await window.electronAPI.zenflowRetryStep(stepId);
  }, []);

  return {
    planSteps,
    workflowStatus,
    loading,
    isZenflowStep,
    getStepForConversation,
    getStepPrompt,
    resume,
    pause,
    retryStep,
  };
}
