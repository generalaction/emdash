import { useState, useEffect, useCallback, useRef } from 'react';
import { detectPlanModeSignal, extractPlanFileName } from '@/lib/planModeDetector';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';

interface UsePlanModeOptions {
  taskId: string;
  providerId: string;
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
  const { taskId, providerId, enabled } = opts;

  const [isActive, setIsActive] = useState(false);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const dismissedAtRef = useRef<number>(0);
  const awaitingPlanRef = useRef(false);
  const targetFileRef = useRef<string | null>(null);

  const mainPtyId = makePtyId(providerId as ProviderId, 'main', taskId);

  const readPlan = useCallback(async (fileName?: string | null) => {
    const api = (window as any).electronAPI;
    if (!api?.planListFiles) return;

    try {
      let targetFile = fileName;

      if (!targetFile) {
        const result = await api.planListFiles();
        if (!result.success || !result.files?.length) return;
        targetFile = result.files[0].name;
      }

      const readResult = await api.planReadFile({ fileName: targetFile });
      if (readResult.success && readResult.content) {
        setPlanContent(readResult.content);
        const now = Date.now();
        if (now - dismissedAtRef.current > DISMISS_COOLDOWN_MS) {
          setIsActive(true);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const api = (window as any).electronAPI;
    if (!api) return;

    api.planWatchStart?.();

    const offFileChanged = api.onPlanFileChanged?.((data: any) => {
      if (!awaitingPlanRef.current) return;
      const file = targetFileRef.current || data.fileName;
      readPlan(file);
    });

    const offData = api.onPtyData?.(mainPtyId, (chunk: string) => {
      try {
        const signal = detectPlanModeSignal(chunk);
        if (signal === 'plan_ready') {
          awaitingPlanRef.current = true;
          const extracted = extractPlanFileName(chunk);
          if (extracted) targetFileRef.current = extracted;
          readPlan(extracted);
        } else if (signal === 'plan_approved' || signal === 'plan_rejected') {
          awaitingPlanRef.current = false;
          targetFileRef.current = null;
          setIsActive(false);
          setPlanContent(null);
        }
      } catch {}
    });

    return () => {
      offFileChanged?.();
      offData?.();
      api.planWatchStop?.();
    };
  }, [enabled, taskId, providerId, mainPtyId, readPlan]);

  const onAccept = useCallback(() => {
    const api = (window as any).electronAPI;
    try {
      api?.ptyInput?.({ id: mainPtyId, data: 'y\n' });
    } catch {}
    awaitingPlanRef.current = false;
    targetFileRef.current = null;
    setIsActive(false);
    setPlanContent(null);
  }, [mainPtyId]);

  const onDecline = useCallback(() => {
    const api = (window as any).electronAPI;
    try {
      api?.ptyInput?.({ id: mainPtyId, data: 'n\n' });
    } catch {}
    awaitingPlanRef.current = false;
    targetFileRef.current = null;
    setIsActive(false);
    setPlanContent(null);
  }, [mainPtyId]);

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
