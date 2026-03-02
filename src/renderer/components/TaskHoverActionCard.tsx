import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const TaskHoverActionCard: React.FC = () => {
  const [value, setValue] = useState<'delete' | 'archive'>('delete');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (result.success && result.settings) {
          setValue(result.settings.interface?.taskHoverAction ?? 'delete');
        }
      } catch (error) {
        console.error('Failed to load task hover action setting:', error);
      }
      setLoading(false);
    })();
  }, []);

  const handleChange = async (next: 'delete' | 'archive') => {
    setValue(next);
    try {
      await window.electronAPI.updateSettings({
        interface: { taskHoverAction: next },
      });
      window.dispatchEvent(new CustomEvent('taskHoverActionChanged', { detail: { value: next } }));
    } catch (error) {
      console.error('Failed to update task hover action setting:', error);
    }
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">Task hover action</p>
        <p className="text-sm text-muted-foreground">
          Primary action when hovering over tasks in the sidebar.
        </p>
      </div>
      <Select value={value} onValueChange={handleChange} disabled={loading}>
        <SelectTrigger className="w-auto shrink-0 gap-2 [&>span]:line-clamp-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="delete">Delete</SelectItem>
          <SelectItem value="archive">Archive</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

export default TaskHoverActionCard;
