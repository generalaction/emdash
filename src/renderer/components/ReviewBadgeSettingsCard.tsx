import React, { useEffect, useState } from 'react';
import { Switch } from './ui/switch';

const ReviewBadgeSettingsCard: React.FC = () => {
  const [showReviewBadge, setShowReviewBadge] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (result.success && result.settings) {
          setShowReviewBadge(Boolean(result.settings.interface?.showReviewBadge ?? true));
        }
      } catch (error) {
        console.error('Failed to load review badge settings:', error);
      }
      setLoading(false);
    })();
  }, []);

  const handleToggle = async (next: boolean) => {
    setShowReviewBadge(next);
    try {
      await window.electronAPI.updateSettings({
        interface: { showReviewBadge: next },
      });
      window.dispatchEvent(
        new CustomEvent('showReviewBadgeChanged', { detail: { enabled: next } })
      );
    } catch (error) {
      console.error('Failed to update review badge setting:', error);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-4 text-sm text-muted-foreground">
        Show a visual indicator on Kanban cards when tasks are ready for review.
      </div>
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">Show review badge</span>
            <span className="text-xs text-muted-foreground">
              Display a &ldquo;Review&rdquo; badge on completed task cards
            </span>
          </div>
          <Switch checked={showReviewBadge} disabled={loading} onCheckedChange={handleToggle} />
        </label>
      </div>
    </div>
  );
};

export default ReviewBadgeSettingsCard;
