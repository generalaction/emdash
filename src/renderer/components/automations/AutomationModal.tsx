import React, { useState, useEffect } from 'react';
import { Github, FolderGit2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import AgentLogo from '../AgentLogo';
import { agentConfig } from '../../lib/agentConfig';
import type {
  Automation,
  AutomationSchedule,
  UpdateAutomationInput,
  ScheduleType,
} from '@shared/automations/types';
import type { Project } from '../../types/app';
import type { Agent } from '../../types';
import {
  SCHEDULE_TYPES,
  DAYS_OF_WEEK,
  HOURS,
  MINUTES,
  DAYS_OF_MONTH,
  buildSchedule,
} from './utils';

interface AutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (input: UpdateAutomationInput) => Promise<void>;
  projects: Project[];
  editingAutomation?: Automation | null;
}

const AutomationModal: React.FC<AutomationModalProps> = ({
  isOpen,
  onClose,
  onUpdate,
  projects,
  editingAutomation,
}) => {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agentId, setAgentId] = useState('claude');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [dayOfWeek, setDayOfWeek] = useState<string>('mon');
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [useWorktree, setUseWorktree] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingAutomation) {
      setName(editingAutomation.name);
      setPrompt(editingAutomation.prompt);
      setAgentId(editingAutomation.agentId);
      setScheduleType(editingAutomation.schedule.type);
      setHour(editingAutomation.schedule.hour ?? 9);
      setMinute(editingAutomation.schedule.minute ?? 0);
      setDayOfWeek(editingAutomation.schedule.dayOfWeek ?? 'mon');
      setDayOfMonth(editingAutomation.schedule.dayOfMonth ?? 1);
      setUseWorktree(editingAutomation.useWorktree ?? true);
    }
    setError(null);
  }, [editingAutomation, isOpen]);

  const selectedProject = editingAutomation
    ? projects.find((p) => p.id === editingAutomation.projectId)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!editingAutomation) return;

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }

    setIsSaving(true);
    try {
      await onUpdate({
        id: editingAutomation.id,
        name: name.trim(),
        prompt: prompt.trim(),
        agentId,
        schedule: buildSchedule(scheduleType, hour, minute, dayOfWeek, dayOfMonth),
        useWorktree,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save automation');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedAgent = agentConfig[agentId as Agent];
  const hasGithub =
    selectedProject?.githubInfo?.connected && selectedProject?.githubInfo?.repository;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Automation</DialogTitle>
          <DialogDescription className="text-xs">Update the automation settings</DialogDescription>
        </DialogHeader>
        <Separator />
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
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

          {/* Project (read-only) */}
          {selectedProject && (
            <div className="space-y-1.5">
              <Label className="text-xs">Project</Label>
              <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                {hasGithub ? (
                  <Github className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate">{selectedProject.name}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Project cannot be changed after creation
              </p>
            </div>
          )}

          {/* Agent */}
          <div className="space-y-1.5">
            <Label className="text-xs">Coding Agent</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select an agent">
                  {selectedAgent && (
                    <div className="flex items-center gap-2">
                      {selectedAgent.logo && (
                        <AgentLogo
                          logo={selectedAgent.logo}
                          alt={selectedAgent.name}
                          isSvg={selectedAgent.isSvg}
                          invertInDark={selectedAgent.invertInDark}
                          className="h-4 w-4 rounded-sm"
                        />
                      )}
                      <span>{selectedAgent.name}</span>
                    </div>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(agentConfig).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      {config.logo && (
                        <AgentLogo
                          logo={config.logo}
                          alt={config.name}
                          isSvg={config.isSvg}
                          invertInDark={config.invertInDark}
                          className="h-4 w-4 rounded-sm"
                        />
                      )}
                      <span>{config.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Prompt */}
          <div className="space-y-1.5">
            <Label htmlFor="auto-prompt" className="text-xs">
              Prompt
            </Label>
            <Textarea
              id="auto-prompt"
              placeholder="What should the agent do?"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[120px] text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              This prompt will be sent to the agent each time the automation runs
            </p>
          </div>

          {/* Schedule */}
          <div className="space-y-3">
            <Label className="text-xs">Schedule</Label>

            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={scheduleType}
                  onValueChange={(v) => setScheduleType(v as ScheduleType)}
                >
                  <SelectTrigger className="w-[130px] text-sm">
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

                {scheduleType === 'weekly' && (
                  <>
                    <span className="text-xs text-muted-foreground">on</span>
                    <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                      <SelectTrigger className="w-[120px] text-sm">
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
                  </>
                )}

                {scheduleType === 'monthly' && (
                  <>
                    <span className="text-xs text-muted-foreground">on the</span>
                    <Select
                      value={String(dayOfMonth)}
                      onValueChange={(v) => setDayOfMonth(Number(v))}
                    >
                      <SelectTrigger className="w-[80px] text-sm">
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
                  </>
                )}

                <span className="text-xs text-muted-foreground">
                  {scheduleType === 'hourly' ? 'at minute' : 'at'}
                </span>

                {scheduleType !== 'hourly' && (
                  <>
                    <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
                      <SelectTrigger className="w-[65px] text-sm">
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
                  </>
                )}

                <Select value={String(minute)} onValueChange={(v) => setMinute(Number(v))}>
                  <SelectTrigger className="w-[65px] text-sm">
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
            </div>
          </div>

          {/* Worktree */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
            <div>
              <Label className="text-xs font-medium">Use worktree</Label>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Create an isolated branch for each run
              </p>
            </div>
            <Switch checked={useWorktree} onCheckedChange={setUseWorktree} />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AutomationModal;
