import React from 'react';
import { Trophy, GitCompare, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

interface DebateResult {
  winner: 'A' | 'B';
  reasoning: string;
  diffA: string;
  diffB: string;
  winnerWorktreePath: string;
  loserWorktreePath: string;
}

interface DebateResultsViewProps {
  result: DebateResult;
  onFollowUp?: () => void;
  onDiscard?: () => void;
  onViewDiff?: (diff: string, label: string) => void;
}

export const DebateResultsView: React.FC<DebateResultsViewProps> = ({
  result,
  onFollowUp,
  onDiscard,
  onViewDiff,
}) => {
  const [showDiffs, setShowDiffs] = React.useState(false);
  const [selectedDiff, setSelectedDiff] = React.useState<'A' | 'B'>(result.winner);

  const winnerLabel = `Agent ${result.winner}`;
  const loserLabel = result.winner === 'A' ? 'Agent B' : 'Agent A';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/20">
            <Trophy className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Debate Complete</h2>
            <p className="text-sm text-muted-foreground">{winnerLabel} won the debate</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Winner announcement */}
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Trophy className="h-4 w-4" />
              <span className="font-medium">Winner: {winnerLabel}</span>
            </div>
          </div>

          {/* Judge reasoning */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Judge's Reasoning</h3>
            <div className="rounded-md border bg-muted/30 p-4">
              <p className="whitespace-pre-wrap text-sm">{result.reasoning}</p>
            </div>
          </div>

          {/* Diff viewer toggle */}
          <div className="space-y-3">
            <button
              onClick={() => setShowDiffs(!showDiffs)}
              className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">View Solution Diffs</span>
              </div>
              {showDiffs ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {showDiffs && (
              <div className="space-y-3">
                {/* Diff tabs */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedDiff('A')}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      selectedDiff === 'A'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                  >
                    Agent A{result.winner === 'A' && <Trophy className="h-3 w-3 text-amber-400" />}
                  </button>
                  <button
                    onClick={() => setSelectedDiff('B')}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      selectedDiff === 'B'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted hover:bg-muted/80'
                    )}
                  >
                    Agent B{result.winner === 'B' && <Trophy className="h-3 w-3 text-amber-400" />}
                  </button>
                </div>

                {/* Diff content */}
                <div className="max-h-[400px] overflow-auto rounded-md border bg-background">
                  <pre className="p-4 text-xs">
                    <code>{selectedDiff === 'A' ? result.diffA : result.diffB}</code>
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="border-t px-6 py-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Continue working with the winning solution?
          </p>
          <div className="flex gap-3">
            {onDiscard && (
              <Button variant="outline" onClick={onDiscard}>
                Discard Both
              </Button>
            )}
            {onFollowUp && (
              <Button onClick={onFollowUp}>
                Open {winnerLabel}'s Solution
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DebateResultsView;
