import { useState, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronLeft, ChevronRight, Copy, GitCompare } from 'lucide-react';
import type { ContentOutput } from '@/types/electron-api';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface OutputComparisonPanelProps {
  outputs: ContentOutput[];
  onSelectOutput?: (id: string) => Promise<boolean | void>;
  onClose?: () => void;
  className?: string;
}

/**
 * Side-by-side comparison panel for content outputs.
 * Allows comparing two outputs and selecting the preferred version.
 */
export function OutputComparisonPanel({
  outputs,
  onSelectOutput,
  onClose,
  className,
}: OutputComparisonPanelProps) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(Math.min(1, outputs.length - 1));
  const [isCopying, setIsCopying] = useState<'left' | 'right' | null>(null);

  const leftOutput = outputs[leftIndex];
  const rightOutput = outputs[rightIndex];

  const handlePrevLeft = useCallback(() => {
    setLeftIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextLeft = useCallback(() => {
    setLeftIndex((prev) => Math.min(outputs.length - 1, prev + 1));
  }, [outputs.length]);

  const handlePrevRight = useCallback(() => {
    setRightIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleNextRight = useCallback(() => {
    setRightIndex((prev) => Math.min(outputs.length - 1, prev + 1));
  }, [outputs.length]);

  const handleCopy = useCallback(
    async (side: 'left' | 'right') => {
      const content = side === 'left' ? leftOutput?.content : rightOutput?.content;
      if (!content) return;

      setIsCopying(side);
      try {
        await navigator.clipboard.writeText(content);
      } finally {
        setTimeout(() => setIsCopying(null), 1000);
      }
    },
    [leftOutput, rightOutput]
  );

  const handleSelect = useCallback(
    async (side: 'left' | 'right') => {
      const output = side === 'left' ? leftOutput : rightOutput;
      if (output && onSelectOutput) {
        await onSelectOutput(output.id);
      }
    },
    [leftOutput, rightOutput, onSelectOutput]
  );

  if (outputs.length < 2) {
    return (
      <Card className={className}>
        <CardContent className="flex h-64 items-center justify-center text-muted-foreground">
          <div className="text-center">
            <GitCompare className="mx-auto mb-2 h-12 w-12 opacity-50" />
            <p>Need at least 2 outputs to compare</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <GitCompare className="h-4 w-4" />
          Compare Outputs
        </h3>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      {/* Comparison controls */}
      <div className="grid grid-cols-2 gap-4 border-b p-4">
        {/* Left output selector */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={handlePrevLeft} disabled={leftIndex === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <div className="text-sm font-medium">{leftOutput?.agentId}</div>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">
                v{leftOutput?.version}
              </Badge>
              {leftOutput?.selected && (
                <Badge variant="default" className="text-xs">
                  Selected
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNextLeft}
            disabled={leftIndex === outputs.length - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Right output selector */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="icon" onClick={handlePrevRight} disabled={rightIndex === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <div className="text-sm font-medium">{rightOutput?.agentId}</div>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">
                v{rightOutput?.version}
              </Badge>
              {rightOutput?.selected && (
                <Badge variant="default" className="text-xs">
                  Selected
                </Badge>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNextRight}
            disabled={rightIndex === outputs.length - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Diff viewer */}
      <div className="min-h-0 flex-1">
        <DiffEditor
          original={leftOutput?.content || ''}
          modified={rightOutput?.content || ''}
          language="markdown"
          theme={isDark ? 'vs-dark' : 'light'}
          options={{
            readOnly: true,
            renderSideBySide: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 13,
            lineNumbers: 'off',
            folding: false,
            renderLineHighlight: 'none',
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            overviewRulerBorder: false,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
            },
          }}
        />
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-4 border-t p-4">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCopy('left')}
            disabled={isCopying !== null}
          >
            <Copy className="mr-1 h-3 w-3" />
            {isCopying === 'left' ? 'Copied!' : 'Copy'}
          </Button>
          {onSelectOutput && !leftOutput?.selected && (
            <Button variant="default" size="sm" onClick={() => handleSelect('left')}>
              <Check className="mr-1 h-3 w-3" />
              Select This
            </Button>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleCopy('right')}
            disabled={isCopying !== null}
          >
            <Copy className="mr-1 h-3 w-3" />
            {isCopying === 'right' ? 'Copied!' : 'Copy'}
          </Button>
          {onSelectOutput && !rightOutput?.selected && (
            <Button variant="default" size="sm" onClick={() => handleSelect('right')}>
              <Check className="mr-1 h-3 w-3" />
              Select This
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OutputComparisonPanel;
