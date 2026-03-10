import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FolderOpen, Plus, Upload, Check, ChevronDown, X } from 'lucide-react';
import type { ContentCollection } from '@/types/electron-api';
import { cn } from '@/lib/utils';

interface CollectionSelectorProps {
  workspaceId: string | null;
  collections: ContentCollection[];
  selectedCollectionId: string | null;
  onSelect: (collectionId: string | null) => void;
  onCreateCollection: (name: string, description?: string) => Promise<ContentCollection | null>;
  onUploadDocuments?: (
    collectionId: string,
    files: Array<{ name: string; content: string }>
  ) => Promise<unknown>;
  disabled?: boolean;
  className?: string;
}

export function CollectionSelector({
  workspaceId,
  collections,
  selectedCollectionId,
  onSelect,
  onCreateCollection,
  onUploadDocuments,
  disabled = false,
  className,
}: CollectionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [pendingFiles, setPendingFiles] = useState<Array<{ name: string; content: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedCollection = collections.find((c) => c.id === selectedCollectionId);

  // Reset create form when popover closes
  useEffect(() => {
    if (!isOpen) {
      setIsCreating(false);
      setNewName('');
      setNewDescription('');
      setPendingFiles([]);
    }
  }, [isOpen]);

  const handleSelectExisting = (collectionId: string) => {
    onSelect(collectionId);
    setIsOpen(false);
  };

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileData: Array<{ name: string; content: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (
        file.name.endsWith('.md') ||
        file.name.endsWith('.txt') ||
        file.name.endsWith('.markdown')
      ) {
        const content = await file.text();
        fileData.push({ name: file.name, content });
      }
    }

    if (fileData.length > 0) {
      setPendingFiles((prev) => [...prev, ...fileData]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleRemoveFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateAndSelect = async () => {
    if (!newName.trim()) return;

    setIsUploading(true);
    try {
      const collection = await onCreateCollection(
        newName.trim(),
        newDescription.trim() || undefined
      );
      if (collection) {
        // Upload pending files if any
        if (pendingFiles.length > 0 && onUploadDocuments) {
          await onUploadDocuments(collection.id, pendingFiles);
        }
        onSelect(collection.id);
        setIsOpen(false);
      }
    } finally {
      setIsUploading(false);
    }
  };

  if (!workspaceId) {
    return (
      <div className={cn('text-sm text-muted-foreground', className)}>
        Select a content workspace first
      </div>
    );
  }

  return (
    <div className={className}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={isOpen}
            disabled={disabled}
            className="w-full justify-between"
          >
            <div className="flex items-center gap-2 truncate">
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span className="truncate">
                {selectedCollection ? selectedCollection.name : 'Select collection...'}
              </span>
            </div>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          {!isCreating ? (
            <div className="flex flex-col">
              {/* Existing collections list */}
              <div className="max-h-60 overflow-auto p-1">
                {collections.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No collections yet
                  </div>
                ) : (
                  collections.map((collection) => (
                    <button
                      key={collection.id}
                      onClick={() => handleSelectExisting(collection.id)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted',
                        selectedCollectionId === collection.id && 'bg-muted'
                      )}
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 truncate">
                        <div className="font-medium">{collection.name}</div>
                        {collection.description && (
                          <div className="truncate text-xs text-muted-foreground">
                            {collection.description}
                          </div>
                        )}
                      </div>
                      {selectedCollectionId === collection.id && (
                        <Check className="h-4 w-4 shrink-0" />
                      )}
                    </button>
                  ))
                )}
              </div>

              {/* Create new button */}
              <div className="border-t p-1">
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                  Create new collection
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-3">
              <div className="text-sm font-medium">Create New Collection</div>

              <div className="space-y-2">
                <Label htmlFor="collection-name">Name</Label>
                <Input
                  id="collection-name"
                  placeholder="Collection name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="collection-desc">Description (optional)</Label>
                <Input
                  id="collection-desc"
                  placeholder="Brief description"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                />
              </div>

              {/* File upload */}
              <div className="space-y-2">
                <Label>Knowledge Documents (optional)</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.txt,.markdown"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Markdown Files
                </Button>

                {/* Pending files list */}
                {pendingFiles.length > 0 && (
                  <div className="space-y-1">
                    {pendingFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded bg-muted px-2 py-1 text-xs"
                      >
                        <span className="truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(index)}
                          className="ml-2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleCreateAndSelect}
                  disabled={!newName.trim() || isUploading}
                >
                  {isUploading ? 'Creating...' : 'Create & Select'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setIsCreating(false)}
                  disabled={isUploading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default CollectionSelector;
