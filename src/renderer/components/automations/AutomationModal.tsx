import React, { useState, useEffect } from 'react';
import { Github, FolderGit2 } from 'lucide-react';
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
import AgentLogo from '../AgentLogo';
import { agentConfig } from '../../lib/agentConfig';
import type {
  Automation,
  AutomationSchedule,
  CreateAutomationInput,
  ScheduleType,
} from '@shared/automations/types';
import type { Project } from '../../types/app';
import type { Agent } from '../../types';
import { SCHEDULE_TYPES, DAYS_OF_WEEK, HOURS, MINUTES, DAYS_OF_MONTH } from './utils';

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

  const selectedAgent = agentConfig[agentId as Agent];
  const selectedProject = projects.find((p) => p.id === projectId);
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
          <DialogTitle>{isEditing ? 'Edit Automation' : 'New Automation'}</DialogTitle>
          <DialogDescription className="text-xs">
            {isEditing
              ? 'Update the automation settings'
              : 'Schedule a recurring task that runs automatically'}
          </DialogDescription>
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

          {/* Project */}
          <div className="space-y-1.5">
            <Label className="text-xs">Project</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select a project">
                  {selectedProject && (
                    <div className="flex items-center gap-2">
                      {hasGithub ? (
                        <Github className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{selectedProject.name}</span>
                    </div>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => {
                  const pHasGh = p.githubInfo?.connected && p.githubInfo?.repository;
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      <div className="flex items-center gap-2">
                        {pHasGh ? (
                          <Github className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span>{p.name}</span>
                        {pHasGh && (
                          <span className="ml-auto text-[10px] text-muted-foreground/50">
                            {p.githubInfo!.repository}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

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
              placeholder="What should the agent do? e.g. 'Review all open PRs and leave comments on code quality issues'"
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
