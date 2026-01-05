import React from 'react';
import { Trophy, GitCompare, ArrowRight, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

export interface DebateResult {
  winner: 'A' | 'B';
  reasoning: string;
  diffA: string;
  diffB: string;
  winnerWorktreePath: string;
  loserWorktreePath: string;
}

interface DebateResultsViewProps {
  result: DebateResult;
  onFollowUp: () => void;
  onDiscard: () => void;
  onViewDiff: (diff: string, label: string) => void;
}

export const DebateResultsView: React.FC<DebateResultsViewProps> = ({
  result,
  onFollowUp,
  onDiscard,
  onViewDiff,
}) => {
  const winnerLabel = `Solution ${result.winner}`;
  const loserLabel = result.winner === 'A' ? 'Solution B' : 'Solution A';
  const winnerDiff = result.winner === 'A' ? result.diffA : result.diffB;
  const loserDiff = result.winner === 'A' ? result.diffB : result.diffA;

  return (
    <div className="space-y-4">
      {/* Winner announcement */}
      <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20">
          <Trophy className="h-5 w-5 text-green-500" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-green-600 dark:text-green-400">
              {winnerLabel} wins!
            </h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{result.reasoning}</p>
        </div>
      </div>

      {/* Diff comparison */}
      <div className="grid gap-3 sm:grid-cols-2">
        <DiffCard
          label={winnerLabel}
          diff={winnerDiff}
          isWinner
          onViewDiff={() => onViewDiff(winnerDiff, winnerLabel)}
        />
        <DiffCard
          label={loserLabel}
          diff={loserDiff}
          isWinner={false}
          onViewDiff={() => onViewDiff(loserDiff, loserLabel)}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onDiscard}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Discard Both
        </Button>
        <Button size="sm" onClick={onFollowUp}>
          Follow Up
          <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

interface DiffCardProps {
  label: string;
  diff: string;
  isWinner: boolean;
  onViewDiff: () => void;
}

const DiffCard: React.FC<DiffCardProps> = ({ label, diff, isWinner, onViewDiff }) => {
  const lineCount = diff.split('\n').length;
  const addedLines = (diff.match(/^\+[^+]/gm) || []).length;
  const removedLines = (diff.match(/^-[^-]/gm) || []).length;

  return (
    <div
      className={cn(
        'rounded-md border p-3',
        isWinner ? 'border-green-500/30 bg-green-500/5' : 'border-border/50 bg-muted/30'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={cn('text-sm font-medium', isWinner && 'text-green-600 dark:text-green-400')}
          >
            {label}
          </span>
          {isWinner && <Trophy className="h-3.5 w-3.5 text-green-500" />}
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onViewDiff}>
          <GitCompare className="mr-1 h-3 w-3" />
          View
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <span>{lineCount} lines</span>
        <span className="text-green-600 dark:text-green-400">+{addedLines}</span>
        <span className="text-red-600 dark:text-red-400">-{removedLines}</span>
      </div>
    </div>
  );
};

export default DebateResultsView;
