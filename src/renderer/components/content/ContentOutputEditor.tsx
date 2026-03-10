import { useState, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Save, Undo2, Check, History, X } from 'lucide-react';
import type { ContentOutput } from '@/types/electron-api';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface ContentOutputEditorProps {
  output: ContentOutput;
  onSave: (content: string) => Promise<ContentOutput | null>;
  onSelect?: () => Promise<boolean>;
  onClose?: () => void;
  className?: string;
}

/**
 * Editor for content outputs with version tracking.
 * Allows editing and saving as a new version.
 */
export function ContentOutputEditor({
  output,
  onSave,
  onSelect,
  onClose,
  className,
}: ContentOutputEditorProps) {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  const [content, setContent] = useState(output.content);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Reset content when output changes
  useEffect(() => {
    setContent(output.content);
    setHasChanges(false);
  }, [output.id, output.content]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      const newContent = value || '';
      setContent(newContent);
      setHasChanges(newContent !== output.content);
    },
    [output.content]
  );

  const handleSave = useCallback(async () => {
    if (!hasChanges) return;

    setIsSaving(true);
    try {
      const result = await onSave(content);
      if (result) {
        setHasChanges(false);
      }
    } finally {
      setIsSaving(false);
    }
  }, [content, hasChanges, onSave]);

  const handleReset = useCallback(() => {
    setContent(output.content);
    setHasChanges(false);
  }, [output.content]);

  const handleSelect = useCallback(async () => {
    if (onSelect) {
      await onSelect();
    }
  }, [onSelect]);

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">Edit Output</h3>
          <Badge variant="outline">{output.agentId}</Badge>
          <Badge variant="secondary">v{output.version}</Badge>
          {output.selected && <Badge variant="default">Selected</Badge>}
          {hasChanges && (
            <Badge
              variant="outline"
              className="border-orange-500/50 bg-orange-500/10 text-xs text-orange-600 dark:text-orange-400"
            >
              Unsaved
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="min-h-0 flex-1">
        <Editor
          value={content}
          language="markdown"
          theme={isDark ? 'vs-dark' : 'light'}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 13,
            lineNumbers: 'on',
            folding: true,
            renderLineHighlight: 'line',
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
            },
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <History className="h-3 w-3" />
          <span>
            Created {new Date(output.createdAt).toLocaleDateString()} at{' '}
            {new Date(output.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="flex gap-2">
          {hasChanges && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <Undo2 className="mr-1 h-3 w-3" />
              Discard
            </Button>
          )}
          {onSelect && !output.selected && (
            <Button variant="outline" size="sm" onClick={handleSelect}>
              <Check className="mr-1 h-3 w-3" />
              Select as Preferred
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            <Save className="mr-1 h-3 w-3" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact version history list for an output.
 */
interface VersionHistoryProps {
  outputs: ContentOutput[];
  currentOutputId: string;
  onSelectVersion: (output: ContentOutput) => void;
  className?: string;
}

export function VersionHistory({
  outputs,
  currentOutputId,
  onSelectVersion,
  className,
}: VersionHistoryProps) {
  // Sort by version descending
  const sortedOutputs = [...outputs].sort((a, b) => b.version - a.version);

  return (
    <div className={cn('space-y-1', className)}>
      <div className="text-xs font-medium text-muted-foreground">Version History</div>
      <div className="space-y-1">
        {sortedOutputs.map((output) => (
          <button
            key={output.id}
            onClick={() => onSelectVersion(output)}
            className={cn(
              'flex w-full items-center justify-between rounded px-2 py-1 text-xs hover:bg-muted',
              currentOutputId === output.id && 'bg-muted'
            )}
          >
            <span className="flex items-center gap-2">
              <span className="font-medium">v{output.version}</span>
              {output.selected && (
                <Badge variant="default" className="h-4 px-1 text-[10px]">
                  Selected
                </Badge>
              )}
            </span>
            <span className="text-muted-foreground">
              {new Date(output.createdAt).toLocaleDateString()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default ContentOutputEditor;
