import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Separator } from '../ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type {
  Automation,
  AutomationSchedule,
  CreateAutomationInput,
  ScheduleType,
} from '@shared/automations/types';
import { PROVIDERS } from '@shared/providers/registry';
import { SCHEDULE_TYPES, DAYS_OF_WEEK, HOURS, MINUTES, DAYS_OF_MONTH } from './utils';

interface Project {
  id: string;
  name: string;
}

interface AutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (input: CreateAutomationInput) => Promise<void>;
  onUpdate?: (id: string, input: Partial<CreateAutomationInput>) => Promise<void>;
  projects: Project[];
  editingAutomation?: Automation | null;
}

const AutomationModal: React.FC<AutomationModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onUpdate,
  projects,
  editingAutomation,
}) => {
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState('claude');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [dayOfWeek, setDayOfWeek] = useState<string>('mon');
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!editingAutomation;

  useEffect(() => {
    if (editingAutomation) {
      setName(editingAutomation.name);
      setProjectId(editingAutomation.projectId);
      setPrompt(editingAutomation.prompt);
      setAgentId(editingAutomation.agentId);
      setScheduleType(editingAutomation.schedule.type);
      setHour(editingAutomation.schedule.hour ?? 9);
      setMinute(editingAutomation.schedule.minute ?? 0);
      setDayOfWeek(editingAutomation.schedule.dayOfWeek ?? 'mon');
      setDayOfMonth(editingAutomation.schedule.dayOfMonth ?? 1);
    } else {
      setName('');
      setProjectId(projects[0]?.id ?? '');
      setPrompt('');
      setAgentId('claude');
      setScheduleType('daily');
      setHour(9);
      setMinute(0);
      setDayOfWeek('mon');
      setDayOfMonth(1);
    }
    setError(null);
  }, [editingAutomation, isOpen, projects]);

  const buildSchedule = (): AutomationSchedule => {
    const base: AutomationSchedule = { type: scheduleType, hour, minute };
    if (scheduleType === 'weekly') base.dayOfWeek = dayOfWeek as any;
    if (scheduleType === 'monthly') base.dayOfMonth = dayOfMonth;
    return base;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!projectId) {
      setError('Please select a project');
      return;
    }
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }

    setIsSaving(true);
    try {
      if (isEditing && onUpdate) {
        await onUpdate(editingAutomation!.id, {
          name: name.trim(),
          projectId,
          prompt: prompt.trim(),
          agentId,
          schedule: buildSchedule(),
        });
      } else {
        await onSave({
          name: name.trim(),
          projectId,
          prompt: prompt.trim(),
          agentId,
          schedule: buildSchedule(),
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save automation');
    } finally {
      setIsSaving(false);
    }
  };

  // Only show providers that have detectable CLI commands (i.e., are actually usable)
  const availableProviders = PROVIDERS.filter((p) => p.commands?.length);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Automation' : 'New Automation'}</DialogTitle>
          <DialogDescription className="text-xs">
            {isEditing
              ? 'Update the automation settings'
              : 'Schedule a recurring task that runs automatically'}
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="auto-name" className="text-xs">
              Name
            </Label>
            <Input
              id="auto-name"
              placeholder="e.g. Daily code review"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Project */}
          <div className="space-y-2">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Agent */}
          <div className="space-y-2">
            <Label className="text-xs">Coding Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select an agent" />
              </SelectTrigger>
              <SelectContent>
                {availableProviders.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="auto-prompt" className="text-xs">
              Prompt
            </Label>
            <Textarea
              id="auto-prompt"
              placeholder="What should the agent do? e.g. 'Review all open PRs and leave comments on code quality issues'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[100px] text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              This prompt will be sent to the agent each time the automation runs
            </p>
          </div>

          {/* Schedule */}
          <div className="space-y-3">
            <Label className="text-xs">Schedule</Label>

            <div className="flex items-center gap-2">
              <Select
                value={scheduleType}
                onValueChange={(v) => setScheduleType(v as ScheduleType)}
              >
                <SelectTrigger className="w-[140px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {scheduleType !== 'hourly' && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">at</span>
                  <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
                    <SelectTrigger className="w-[70px] text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOURS.map((h) => (
                        <SelectItem key={h.value} value={String(h.value)}>
                          {h.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">:</span>
                  <Select value={String(minute)} onValueChange={(v) => setMinute(Number(v))}>
                    <SelectTrigger className="w-[70px] text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MINUTES.map((m) => (
                        <SelectItem key={m.value} value={String(m.value)}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {scheduleType === 'hourly' && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">at minute</span>
                  <Select value={String(minute)} onValueChange={(v) => setMinute(Number(v))}>
                    <SelectTrigger className="w-[70px] text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MINUTES.map((m) => (
                        <SelectItem key={m.value} value={String(m.value)}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {scheduleType === 'weekly' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">on</span>
                <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                  <SelectTrigger className="w-[140px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {scheduleType === 'monthly' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">on the</span>
                <Select value={String(dayOfMonth)} onValueChange={(v) => setDayOfMonth(Number(v))}>
                  <SelectTrigger className="w-[100px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_MONTH.map((d) => (
                      <SelectItem key={d.value} value={String(d.value)}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Automation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AutomationModal;
