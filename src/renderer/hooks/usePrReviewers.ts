import { useEffect, useState } from 'react';
import { subscribeToReviewers, refreshReviewers, invalidateReviewers } from '../lib/reviewersStore';
import type { Reviewer } from '../lib/reviewersStatus';
import { useToast } from './use-toast';

export function usePrReviewers(taskPath?: string, hasPr = false) {
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [isLoading, setIsLoading] = useState(!!taskPath && hasPr);
  const [pendingLogins, setPendingLogins] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    if (!taskPath || !hasPr) {
      setReviewers([]);
      setIsLoading(false);
      return;
    }
    setReviewers([]);
    setIsLoading(true);
    return subscribeToReviewers(taskPath, (data) => {
      setReviewers(data);
      setIsLoading(false);
    });
  }, [taskPath, hasPr]);

  const addReviewer = async (login: string) => {
    if (!taskPath) return;
    setPendingLogins((prev) => new Set(prev).add(login));
    try {
      const res = await window.electronAPI.addPrReviewer({ taskPath, login });
      if (!res.success) {
        toast({ title: `Failed to add reviewer`, description: res.error, variant: 'destructive' });
      } else {
        invalidateReviewers(taskPath);
        await refreshReviewers(taskPath);
      }
    } catch {
      toast({ title: 'Failed to add reviewer', variant: 'destructive' });
    } finally {
      setPendingLogins((prev) => {
        const next = new Set(prev);
        next.delete(login);
        return next;
      });
    }
  };

  const removeReviewer = async (login: string) => {
    if (!taskPath) return;
    setPendingLogins((prev) => new Set(prev).add(login));
    try {
      const res = await window.electronAPI.removePrReviewer({ taskPath, login });
      if (!res.success) {
        toast({
          title: `Failed to remove reviewer`,
          description: res.error,
          variant: 'destructive',
        });
      } else {
        invalidateReviewers(taskPath);
        await refreshReviewers(taskPath);
      }
    } catch {
      toast({ title: 'Failed to remove reviewer', variant: 'destructive' });
    } finally {
      setPendingLogins((prev) => {
        const next = new Set(prev);
        next.delete(login);
        return next;
      });
    }
  };

  return { reviewers, isLoading, pendingLogins, addReviewer, removeReviewer };
}
