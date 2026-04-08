import React from 'react';
import { Switch } from './ui/switch';
import { useAppSettings } from '@/contexts/AppSettingsProvider';

const CommitDetailSettingsCard: React.FC = () => {
  const { settings, updateSettings, isLoading: loading } = useAppSettings();

  const expandCommitDetail = settings?.interface?.expandCommitDetail ?? false;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          Expand commit details by default
        </span>
        <span className="text-sm text-muted-foreground">
          Automatically show the full commit message and author when selecting a commit in the
          History tab
        </span>
      </div>
      <Switch
        checked={expandCommitDetail}
        defaultChecked={expandCommitDetail}
        disabled={loading}
        onCheckedChange={(checked) =>
          updateSettings({ interface: { expandCommitDetail: checked } })
        }
      />
    </div>
  );
};

export default CommitDetailSettingsCard;
