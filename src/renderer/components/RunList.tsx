import React from 'react';
import { Run } from '../types';

interface RunListProps {
  runs: Run[];
  selectedRun: Run | null;
  onRunSelect: (run: Run) => void;
}

const RunList: React.FC<RunListProps> = ({ runs, selectedRun, onRunSelect }) => {
  const formatDuration = (startedAt: string, finishedAt?: string | null) => {
    const start = new Date(startedAt);
    const end = finishedAt ? new Date(finishedAt) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffSecs = Math.floor((diffMs % (1000 * 60)) / 1000);

    if (diffMins > 0) {
      return `${diffMins}m ${diffSecs}s`;
    }
    return `${diffSecs}s`;
  };

  const getStatusColor = (status: Run['status']) => {
    switch (status) {
      case 'running':
        return 'text-blue-400';
      case 'completed':
        return 'text-green-400';
      case 'failed':
        return 'text-red-400';
      case 'cancelled':
        return 'text-muted-foreground';
      default:
        return 'text-yellow-400';
    }
  };

  const getStatusIcon = (status: Run['status']) => {
    switch (status) {
      case 'running':
        return '🔄';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'cancelled':
        return '⏹️';
      default:
        return '⏳';
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4">
        <h3 className="mb-4 text-lg font-semibold text-white">Active Runs</h3>

        {runs.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-muted-foreground">No runs found</div>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <div
                key={run.id}
                className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                  selectedRun?.id === run.id
                    ? 'border-blue-500 bg-blue-600'
                    : 'border-border bg-card hover:bg-accent'
                }`}
                onClick={() => onRunSelect(run)}
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getStatusIcon(run.status)}</span>
                    <span className={`font-medium ${getStatusColor(run.status)}`}>
                      {run.status.toUpperCase()}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {run.provider === 'claude-code' ? 'Claude' : 'OpenAI'}
                  </div>
                </div>

                <div className="mb-2 text-sm text-muted-foreground">
                  <strong>Branch:</strong> {run.branch}
                </div>

                <div className="line-clamp-2 text-sm text-muted-foreground">{run.prompt}</div>

                {run.tokenUsage > 0 && (
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Tokens: {run.tokenUsage.toLocaleString()}</span>
                    {run.cost > 0 && <span>Cost: ${run.cost.toFixed(4)}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RunList;
