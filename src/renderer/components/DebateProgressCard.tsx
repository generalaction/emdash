import React from 'react';
import { motion } from 'motion/react';
import { Bot, CheckCircle2, XCircle, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

export interface AgentProgress {
  id: string;
  status: 'running' | 'complete' | 'error';
  currentTool?: string;
  elapsedMs: number;
  error?: string;
}

interface DebateProgressCardProps {
  taskName: string;
  prompt: string;
  agents: AgentProgress[];
  judgeStatus?: 'running' | 'complete' | 'error';
  judgeElapsedMs?: number;
  onCancel?: () => void;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

const ShimmerText: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <motion.span
    className={cn('inline-block', className)}
    animate={{
      opacity: [0.5, 1, 0.5],
    }}
    transition={{
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    }}
  >
    {children}
  </motion.span>
);

const AgentStatusRow: React.FC<{ agent: AgentProgress }> = ({ agent }) => {
  const isRunning = agent.status === 'running';
  const isComplete = agent.status === 'complete';
  const isError = agent.status === 'error';

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border px-3 py-2',
        isRunning && 'border-blue-500/30 bg-blue-500/5',
        isComplete && 'border-green-500/30 bg-green-500/5',
        isError && 'border-red-500/30 bg-red-500/5'
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full',
          isRunning && 'bg-blue-500/20',
          isComplete && 'bg-green-500/20',
          isError && 'bg-red-500/20'
        )}
      >
        {isRunning && <Bot className="h-4 w-4 text-blue-500" />}
        {isComplete && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {isError && <XCircle className="h-4 w-4 text-red-500" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Agent {agent.id}</span>
          {isRunning && (
            <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
              running
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {isRunning && agent.currentTool ? (
            <ShimmerText>{agent.currentTool}...</ShimmerText>
          ) : isRunning ? (
            <ShimmerText>Thinking...</ShimmerText>
          ) : isComplete ? (
            'Completed'
          ) : (
            agent.error || 'Failed'
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {formatElapsed(agent.elapsedMs)}
      </div>
    </div>
  );
};

export const DebateProgressCard: React.FC<DebateProgressCardProps> = ({
  taskName,
  prompt,
  agents,
  judgeStatus,
  judgeElapsedMs,
  onCancel,
}) => {
  const allAgentsComplete = agents.every((a) => a.status === 'complete' || a.status === 'error');
  const isJudging = judgeStatus === 'running';

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">Debate Mode</h3>
          <p className="mt-1 text-sm text-muted-foreground">{taskName}</p>
        </div>
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} className="shrink-0">
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
        )}
      </div>

      {/* Prompt preview */}
      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">Prompt</p>
        <p className="mt-1 line-clamp-3 text-sm">{prompt}</p>
      </div>

      {/* Status header */}
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">
          {!allAgentsComplete && 'Agents working...'}
          {allAgentsComplete && isJudging && 'Judging solutions...'}
          {allAgentsComplete && !isJudging && judgeStatus === 'complete' && 'Debate complete'}
        </h4>
        {(!allAgentsComplete || isJudging) && (
          <motion.div
            className={cn('h-2 w-2 rounded-full', isJudging ? 'bg-amber-500' : 'bg-blue-500')}
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
      </div>

      {/* Agent statuses */}
      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentStatusRow key={agent.id} agent={agent} />
        ))}
      </div>

      {/* Judge status */}
      {isJudging && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20">
            <Bot className="h-4 w-4 text-amber-500" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Judge</div>
            <ShimmerText className="text-xs text-muted-foreground">
              Comparing solutions...
            </ShimmerText>
          </div>
          {judgeElapsedMs !== undefined && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatElapsed(judgeElapsedMs)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DebateProgressCard;
