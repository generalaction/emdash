import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FolderOpen, Plus, Trash2, FileText, Check, X } from 'lucide-react';
import type { ContentCollection } from '@/types/electron-api';

interface CollectionListProps {
  collections: ContentCollection[];
  selectedCollection: ContentCollection | null;
  onSelectCollection: (collection: ContentCollection | null) => void;
  onCreateCollection: (name: string, description?: string) => Promise<ContentCollection | null>;
  onDeleteCollection: (id: string) => Promise<boolean>;
}

export function CollectionList({
  collections,
  selectedCollection,
  onSelectCollection,
  onCreateCollection,
  onDeleteCollection,
}: CollectionListProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;

    const result = await onCreateCollection(newName.trim(), newDescription.trim() || undefined);
    if (result) {
      setIsCreating(false);
      setNewName('');
      setNewDescription('');
      onSelectCollection(result);
    }
  }, [newName, newDescription, onCreateCollection, onSelectCollection]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      await onDeleteCollection(id);
    },
    [onDeleteCollection]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Collections</h3>
        {!isCreating && (
          <Button size="sm" variant="outline" onClick={() => setIsCreating(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New Collection
          </Button>
        )}
      </div>

      {isCreating && (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <Input
              placeholder="Collection name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate}>
                <Check className="mr-1 h-4 w-4" />
                Create
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsCreating(false);
                  setNewName('');
                  setNewDescription('');
                }}
              >
                <X className="mr-1 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {collections.length === 0 && !isCreating && (
        <div className="py-8 text-center text-muted-foreground">
          <FolderOpen className="mx-auto mb-2 h-12 w-12 opacity-50" />
          <p>No collections yet.</p>
          <p className="text-sm">Create a collection to organize your knowledge documents.</p>
        </div>
      )}

      <div className="space-y-2">
        {collections.map((collection) => (
          <Card
            key={collection.id}
            className={`cursor-pointer transition-colors hover:bg-muted/50 ${
              selectedCollection?.id === collection.id ? 'border-primary bg-muted/30' : ''
            }`}
            onClick={() => onSelectCollection(collection)}
          >
            <CardContent className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FolderOpen className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{collection.name}</div>
                    {collection.description && (
                      <div className="text-sm text-muted-foreground">{collection.description}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1">
                    <FileText className="h-3 w-3" />
                    {collection.documentCount || 0}
                  </Badge>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={(e) => handleDelete(e, collection.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
