import { useState, useEffect, useCallback, useRef } from 'react';
import { detectPlanModeSignal } from '@/lib/planModeDetector';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';

interface UsePlanModeOptions {
  taskId: string;
  taskPath: string | null;
  providerId: string;
  terminalId: string;
  enabled: boolean;
}

interface PlanModeResult {
  isActive: boolean;
  planContent: string | null;
  onAccept: () => void;
  onDecline: () => void;
  onDismiss: () => void;
}

const DISMISS_COOLDOWN_MS = 5000;

export function usePlanMode(opts: UsePlanModeOptions): PlanModeResult {
  const { taskId, taskPath, providerId, terminalId, enabled } = opts;

  const [isActive, setIsActive] = useState(false);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const dismissedAtRef = useRef<number>(0);
  const lastFileNameRef = useRef<string | null>(null);

  const readLatestPlan = useCallback(async () => {
    if (!taskPath) return;
    const api = (window as any).electronAPI;
    if (!api?.planListFiles) return;

    try {
      const result = await api.planListFiles(taskPath);
      if (!result.success || !result.files?.length) return;

      const latestFile = result.files[0];
      lastFileNameRef.current = latestFile.name;

      const readResult = await api.planReadFile({
        taskPath,
        fileName: latestFile.name,
      });
      if (readResult.success && readResult.content) {
        setPlanContent(readResult.content);
        const now = Date.now();
        if (now - dismissedAtRef.current > DISMISS_COOLDOWN_MS) {
          setIsActive(true);
        }
      }
    } catch {}
  }, [taskPath]);

  useEffect(() => {
    if (!enabled || !taskPath) return;

    const api = (window as any).electronAPI;
    if (!api) return;

    api.planWatchStart?.(taskPath);

    const offFileChanged = api.onPlanFileChanged?.((data: any) => {
      if (data.taskPath !== taskPath) return;
      readLatestPlan();
    });

    const ptyId = makePtyId(providerId as ProviderId, 'main', taskId);
    const offData = api.onPtyData?.(ptyId, (chunk: string) => {
      try {
        const signal = detectPlanModeSignal(chunk);
        if (signal === 'plan_ready') {
          readLatestPlan();
        } else if (signal === 'plan_approved' || signal === 'plan_rejected') {
          setIsActive(false);
          setPlanContent(null);
        }
      } catch {}
    });

    readLatestPlan();

    return () => {
      offFileChanged?.();
      offData?.();
      api.planWatchStop?.(taskPath);
    };
  }, [enabled, taskPath, taskId, providerId, readLatestPlan]);

  const onAccept = useCallback(() => {
    const api = (window as any).electronAPI;
    try {
      api?.ptyInput?.({ id: terminalId, data: 'y\n' });
    } catch {}
    setIsActive(false);
    setPlanContent(null);
  }, [terminalId]);

  const onDecline = useCallback(() => {
    const api = (window as any).electronAPI;
    try {
      api?.ptyInput?.({ id: terminalId, data: 'n\n' });
    } catch {}
    setIsActive(false);
    setPlanContent(null);
  }, [terminalId]);

  const onDismiss = useCallback(() => {
    dismissedAtRef.current = Date.now();
    setIsActive(false);
  }, []);

  return {
    isActive: enabled && isActive,
    planContent,
    onAccept,
    onDecline,
    onDismiss,
  };
}
