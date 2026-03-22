import React, { useState, useEffect, useRef } from 'react';
import { GitBranch, FolderGit2, Clock, MoreHorizontal, Github, FolderOpen } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import AgentLogo from '../AgentLogo';
import { agentConfig } from '../../lib/agentConfig';
import type { CreateAutomationInput, ScheduleType } from '@shared/automations/types';
import type { Project } from '../../types/app';
import type { Agent } from '../../types';
import {
  SCHEDULE_TYPES,
  DAYS_OF_WEEK,
  HOURS,
  MINUTES,
  DAYS_OF_MONTH,
  formatScheduleLabel,
  buildSchedule,
} from './utils';

interface AutomationInlineCreateProps {
  projects: Project[];
  prefill?: { name: string; prompt: string } | null;
  onSave: (input: CreateAutomationInput) => Promise<void>;
  onCancel: () => void;
}

const AutomationInlineCreate: React.FC<AutomationInlineCreateProps> = ({
  projects,
  prefill,
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState(prefill?.name ?? '');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [prompt, setPrompt] = useState(prefill?.prompt ?? '');
  const [agentId, setAgentId] = useState('claude');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [dayOfWeek, setDayOfWeek] = useState('mon');
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [useWorktree, setUseWorktree] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (prefill && !initializedRef.current) {
      setName(prefill.name);
      setPrompt(prefill.prompt);
      initializedRef.current = true;
    }
  }, [prefill]);

  // Reset when component unmounts so remounting re-initializes
  useEffect(() => {
    return () => {
      initializedRef.current = false;
    };
  }, []);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const currentSchedule = buildSchedule(scheduleType, hour, minute, dayOfWeek, dayOfMonth);
  const schedulePreview = formatScheduleLabel(currentSchedule);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!projectId) {
      setError('Select a project');
      return;
    }
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        name: name.trim(),
        projectId,
        prompt: prompt.trim(),
        agentId,
        schedule: buildSchedule(scheduleType, hour, minute, dayOfWeek, dayOfMonth),
        useWorktree,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const selectedProject = projects.find((p) => p.id === projectId);
  const selectedAgent = agentConfig[agentId as Agent];
  const hasGithub =
    selectedProject?.githubInfo?.connected && selectedProject?.githubInfo?.repository;

  return (
    <div
      className="mb-8 overflow-hidden rounded-lg border border-border/60 bg-muted/10"
      onKeyDown={handleKeyDown}
    >
      {/* Title row */}
      <div className="px-4 pb-0 pt-4">
        <Input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Automation title"
          className="border-0 bg-transparent px-0 text-sm font-medium placeholder:text-muted-foreground/40 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>

      {/* Prompt textarea */}
      <div className="px-4 pb-3">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Add prompt e.g. look for crashes in $sentry"
          className="min-h-[100px] resize-none border-0 bg-transparent px-0 text-sm placeholder:text-muted-foreground/30 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>

      {error && (
        <div className="px-4 pb-2">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Bottom toolbar */}
      <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-1">
          {/* Worktree toggle with slide animation */}
          <Button
            type="button"
            variant={useWorktree ? 'secondary' : 'ghost'}
            size="sm"
            className="relative h-7 w-[88px] overflow-hidden text-xs text-muted-foreground"
            onClick={() => setUseWorktree(!useWorktree)}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={useWorktree ? 'worktree' : 'main'}
                className="flex items-center justify-center gap-1.5"
                initial={{ y: 12, opacity: 0, filter: 'blur(2px)' }}
                animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                exit={{ y: -12, opacity: 0, filter: 'blur(2px)' }}
                transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
              >
                {useWorktree ? (
                  <>
                    <GitBranch className="h-3 w-3 shrink-0" />
                    Worktree
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-3 w-3 shrink-0" />
                    Direct
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </Button>

          {/* Project select */}
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="h-7 w-auto gap-1.5 border-0 bg-transparent text-xs text-muted-foreground shadow-none hover:bg-muted/60">
              {hasGithub ? (
                <Github className="h-3 w-3 shrink-0" />
              ) : (
                <FolderGit2 className="h-3 w-3 shrink-0" />
              )}
              <span className="max-w-[120px] truncate">
                {selectedProject?.name ?? 'Select project'}
              </span>
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => {
                const pGh = p.githubInfo?.connected && p.githubInfo?.repository;
                return (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2">
                      {pGh ? (
                        <Github className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <FolderGit2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span>{p.name}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {/* Schedule */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
              >
                <Clock className="h-3 w-3" />
                <span className="max-w-[140px] truncate">{schedulePreview}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="start">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={scheduleType}
                    onValueChange={(v) => setScheduleType(v as ScheduleType)}
                  >
                    <SelectTrigger className="h-7 w-[110px] text-xs">
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
                      <span className="text-[10px] text-muted-foreground">on</span>
                      <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                        <SelectTrigger className="h-7 w-[100px] text-xs">
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
                      <span className="text-[10px] text-muted-foreground">on the</span>
                      <Select
                        value={String(dayOfMonth)}
                        onValueChange={(v) => setDayOfMonth(Number(v))}
                      >
                        <SelectTrigger className="h-7 w-[70px] text-xs">
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

                  <span className="text-[10px] text-muted-foreground">
                    {scheduleType === 'hourly' ? 'at minute' : 'at'}
                  </span>

                  {scheduleType !== 'hourly' && (
                    <>
                      <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
                        <SelectTrigger className="h-7 w-[55px] text-xs">
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
                      <span className="text-[10px] text-muted-foreground">:</span>
                    </>
                  )}

                  <Select value={String(minute)} onValueChange={(v) => setMinute(Number(v))}>
                    <SelectTrigger className="h-7 w-[55px] text-xs">
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
            </PopoverContent>
          </Popover>

          {/* More options (agent, worktree) */}
          <Popover open={showMore} onOpenChange={setShowMore}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 text-muted-foreground"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
              <div className="space-y-3">
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Agent</Label>
                  <Select value={agentId} onValueChange={setAgentId}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue>
                        {selectedAgent && (
                          <div className="flex items-center gap-2">
                            {selectedAgent.logo && (
                              <AgentLogo
                                logo={selectedAgent.logo}
                                alt={selectedAgent.name}
                                isSvg={selectedAgent.isSvg}
                                invertInDark={selectedAgent.invertInDark}
                                className="h-3.5 w-3.5 rounded-sm"
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
                                className="h-3.5 w-3.5 rounded-sm"
                              />
                            )}
                            <span>{config.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs">Use worktree</Label>
                    <p className="text-[10px] text-muted-foreground">Isolated branch per run</p>
                  </div>
                  <Switch checked={useWorktree} onCheckedChange={setUseWorktree} />
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Cancel + Create */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default AutomationInlineCreate;
