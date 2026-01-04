import React from 'react';
import { motion } from 'motion/react';
import { Bot, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AgentProgress {
  id: string;
  status: 'running' | 'complete' | 'error';
  currentTool?: string;
  elapsedMs: number;
  error?: string;
}

interface DebateProgressCardProps {
  agents: AgentProgress[];
  phase: 'running' | 'judging' | 'complete';
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

function getToolDisplayName(toolName: string): string {
  const toolMap: Record<string, string> = {
    Write: 'Writing file',
    Edit: 'Editing file',
    Read: 'Reading file',
    Bash: 'Running command',
    Glob: 'Searching files',
    Grep: 'Searching content',
    TodoWrite: 'Updating tasks',
    WebFetch: 'Fetching web content',
    WebSearch: 'Searching web',
  };
  return toolMap[toolName] || `Using ${toolName}`;
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
            <ShimmerText>{getToolDisplayName(agent.currentTool)}...</ShimmerText>
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

export const DebateProgressCard: React.FC<DebateProgressCardProps> = ({ agents, phase }) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">
          {phase === 'running' && 'Agents working...'}
          {phase === 'judging' && 'Judging solutions...'}
          {phase === 'complete' && 'Debate complete'}
        </h3>
        {phase === 'judging' && (
          <motion.div
            className="h-2 w-2 rounded-full bg-amber-500"
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        )}
      </div>

      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentStatusRow key={agent.id} agent={agent} />
        ))}
      </div>

      {phase === 'judging' && (
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
        </div>
      )}
    </div>
  );
};

export default DebateProgressCard;
