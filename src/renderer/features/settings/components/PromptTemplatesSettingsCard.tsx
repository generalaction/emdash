import { ArrowDown, ArrowUp, Copy, FileSearch, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import {
  MAX_PROMPT_TEMPLATES,
  STARTER_PROMPT_TEMPLATES,
  type PromptTemplate,
} from '@shared/prompt-templates';
import { usePromptTemplates } from '@renderer/features/settings/use-prompt-templates';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';

const MAX_NAME_LENGTH = 64;
const MAX_TEXT_LENGTH = 4000;

function PromptTemplateEditor({
  template,
  onSave,
  onCancel,
  isSaving,
}: {
  template?: PromptTemplate;
  onSave: (name: string, text: string) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [text, setText] = useState(template?.text ?? '');
  const canSave = name.trim().length > 0 && text.trim().length > 0 && !isSaving;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <Input
        placeholder="Template name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={isSaving}
        className="text-sm"
        maxLength={MAX_NAME_LENGTH}
      />
      <div className="relative">
        <Textarea
          placeholder="Prompt text..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={isSaving}
          className="min-h-24 text-sm"
          maxLength={MAX_TEXT_LENGTH}
        />
        <span className="absolute bottom-2 right-2 text-xs text-muted-foreground">
          {text.length} / {MAX_TEXT_LENGTH}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
          <X className="mr-1 h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button variant="default" size="sm" onClick={() => onSave(name, text)} disabled={!canSave}>
          {template ? 'Update' : 'Add'}
        </Button>
      </div>
    </div>
  );
}

function EmptyState({
  onAdd,
  onPickStarter,
}: {
  onAdd: () => void;
  onPickStarter: (name: string, text: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border bg-background py-10">
      <FileSearch className="h-8 w-8 text-muted-foreground" />
      <div className="flex flex-col items-center gap-1">
        <p className="text-sm font-medium">No prompt templates yet</p>
        <p className="text-xs text-muted-foreground">
          Create reusable prompts for common tasks like review, summarize, and testing.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 px-4">
        {STARTER_PROMPT_TEMPLATES.map((starter) => (
          <Button
            key={starter.name}
            variant="outline"
            size="sm"
            onClick={() => onPickStarter(starter.name, starter.text)}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {starter.name}
          </Button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onAdd}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Create custom template
      </Button>
    </div>
  );
}

export function PromptTemplatesSettingsCard() {
  const {
    templates,
    isLoading,
    isSaving,
    create,
    update,
    delete: deleteTemplate,
    reorder,
  } = usePromptTemplates();
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftText, setDraftText] = useState('');
  const isAtMaxTemplates = templates.length >= MAX_PROMPT_TEMPLATES;

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  const handleCreate = (name: string, text: string) => {
    create(
      { name, text },
      {
        onError: (err) => {
          toast({
            title: 'Failed to add template',
            description: err.message,
            variant: 'destructive',
          });
        },
        onSuccess: () => {
          setIsAdding(false);
          setDraftName('');
          setDraftText('');
        },
      }
    );
  };

  const handleUpdate = (id: string, name: string, text: string) => {
    update(
      { id, input: { name, text } },
      {
        onError: (err) => {
          toast({
            title: 'Failed to update template',
            description: err.message,
            variant: 'destructive',
          });
        },
        onSuccess: () => setEditingId(null),
      }
    );
  };

  const handleDelete = (id: string) => {
    deleteTemplate(id, {
      onError: (err) => {
        toast({
          title: 'Failed to delete template',
          description: err.message,
          variant: 'destructive',
        });
      },
      onSuccess: () => setDeletingId(null),
    });
  };

  const handleDuplicate = (template: PromptTemplate) => {
    create(
      { name: `${template.name} (copy)`, text: template.text },
      {
        onError: (err) => {
          toast({
            title: 'Failed to duplicate template',
            description: err.message,
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (templates.length < 2) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= templates.length) return;
    const reordered = [...templates];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(newIndex, 0, moved);
    reorder(reordered.map((t) => t.id));
  };

  const startAddingWithDraft = (name: string, text: string) => {
    setDraftName(name);
    setDraftText(text);
    setIsAdding(true);
  };

  return (
    <div className="space-y-4">
      {templates.length === 0 && !isAdding && (
        <EmptyState onAdd={() => setIsAdding(true)} onPickStarter={startAddingWithDraft} />
      )}

      <div className="space-y-3">
        {templates.map((template, index) => (
          <div key={template.id}>
            {editingId === template.id ? (
              <PromptTemplateEditor
                template={template}
                onSave={(name, text) => handleUpdate(template.id, name, text)}
                onCancel={() => setEditingId(null)}
                isSaving={isSaving}
              />
            ) : (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-background p-3">
                <div className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-medium">{template.name}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {template.text}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === 0 || isSaving}
                    onClick={() => handleMove(index, 'up')}
                    aria-label="Move template up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={index === templates.length - 1 || isSaving}
                    onClick={() => handleMove(index, 'down')}
                    aria-label="Move template down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={isSaving || isAtMaxTemplates}
                    onClick={() => handleDuplicate(template)}
                    title="Duplicate"
                    aria-label="Duplicate template"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={isSaving}
                    onClick={() => setEditingId(template.id)}
                    aria-label="Edit template"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {deletingId === template.id ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        disabled={isSaving}
                        onClick={() => handleDelete(template.id)}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        disabled={isSaving}
                        onClick={() => setDeletingId(null)}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={isSaving}
                      onClick={() => setDeletingId(template.id)}
                      title="Delete"
                      aria-label="Delete template"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdding && (
        <PromptTemplateEditor
          template={
            draftName || draftText
              ? {
                  id: '',
                  name: draftName,
                  text: draftText,
                  sortOrder: 0,
                  createdAt: '',
                  updatedAt: '',
                }
              : undefined
          }
          onSave={handleCreate}
          onCancel={() => {
            setIsAdding(false);
            setDraftName('');
            setDraftText('');
          }}
          isSaving={isSaving}
        />
      )}

      {templates.length > 0 && !isAdding && !isAtMaxTemplates && (
        <Button variant="outline" size="sm" onClick={() => setIsAdding(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add template
        </Button>
      )}

      {isAtMaxTemplates && (
        <p className="text-xs text-muted-foreground">
          Template limit reached ({MAX_PROMPT_TEMPLATES}). Delete one to add another.
        </p>
      )}
    </div>
  );
}
