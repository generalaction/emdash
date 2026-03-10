import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import type { BrandGuideline } from '@/types/electron-api';

interface BrandEditorProps {
  brands: BrandGuideline[];
  activeBrand: BrandGuideline | null;
  onCreateBrand: (
    name: string,
    content: string,
    isActive?: boolean
  ) => Promise<BrandGuideline | null>;
  onUpdateBrand: (
    id: string,
    updates: Partial<{ name: string; content: string; isActive: boolean }>
  ) => Promise<BrandGuideline | null>;
  onDeleteBrand: (id: string) => Promise<boolean>;
  onSetActive: (id: string) => Promise<BrandGuideline | null>;
}

export function BrandEditor({
  brands,
  activeBrand,
  onCreateBrand,
  onUpdateBrand,
  onDeleteBrand,
  onSetActive,
}: BrandEditorProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;

    const result = await onCreateBrand(newName.trim(), newContent, true);
    if (result) {
      setIsCreating(false);
      setNewName('');
      setNewContent('');
    }
  }, [newName, newContent, onCreateBrand]);

  const handleStartEdit = useCallback((brand: BrandGuideline) => {
    setEditingId(brand.id);
    setEditName(brand.name);
    setEditContent(brand.content);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return;

    await onUpdateBrand(editingId, {
      name: editName.trim(),
      content: editContent,
    });
    setEditingId(null);
  }, [editingId, editName, editContent, onUpdateBrand]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Brand Guidelines</h3>
        {!isCreating && (
          <Button size="sm" variant="outline" onClick={() => setIsCreating(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New Brand
          </Button>
        )}
      </div>

      {isCreating && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Create Brand Guideline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Brand name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Textarea
              placeholder="Enter your brand guidelines in markdown..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={8}
              className="font-mono text-sm"
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
                  setNewContent('');
                }}
              >
                <X className="mr-1 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {brands.length === 0 && !isCreating && (
        <div className="py-8 text-center text-muted-foreground">
          <p>No brand guidelines yet.</p>
          <p className="text-sm">Create one to define your writing tone and style.</p>
        </div>
      )}

      <div className="space-y-3">
        {brands.map((brand) => (
          <Card key={brand.id} className={brand.isActive ? 'border-primary' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                {editingId === brand.id ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="max-w-xs"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{brand.name}</CardTitle>
                    {brand.isActive && <Badge variant="default">Active</Badge>}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {editingId === brand.id ? (
                    <>
                      <Button size="icon" variant="ghost" onClick={handleSaveEdit}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={handleCancelEdit}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      {!brand.isActive && (
                        <Button size="sm" variant="outline" onClick={() => onSetActive(brand.id)}>
                          Set Active
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => handleStartEdit(brand)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => onDeleteBrand(brand.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {editingId === brand.id ? (
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                />
              ) : (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 text-sm text-muted-foreground">
                  {brand.content || '(No content)'}
                </pre>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
