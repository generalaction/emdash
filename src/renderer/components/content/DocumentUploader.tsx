import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Upload, FileText, Plus, Check, X, Trash2 } from 'lucide-react';
import type { KnowledgeDocument } from '@/types/electron-api';

interface DocumentUploaderProps {
  collectionId: string;
  documents: KnowledgeDocument[];
  onCreateDocument: (
    name: string,
    content: string,
    metadata?: Record<string, unknown>
  ) => Promise<KnowledgeDocument | null>;
  onUploadDocuments: (
    files: Array<{ name: string; content: string }>
  ) => Promise<KnowledgeDocument[] | null>;
  onDeleteDocument: (id: string) => Promise<boolean>;
  onSelectDocument: (document: KnowledgeDocument | null) => void;
  selectedDocument: KnowledgeDocument | null;
}

export function DocumentUploader({
  collectionId,
  documents,
  onCreateDocument,
  onUploadDocuments,
  onDeleteDocument,
  onSelectDocument,
  selectedDocument,
}: DocumentUploaderProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;

    const result = await onCreateDocument(newName.trim(), newContent);
    if (result) {
      setIsCreating(false);
      setNewName('');
      setNewContent('');
    }
  }, [newName, newContent, onCreateDocument]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setIsUploading(true);

      try {
        const fileData: Array<{ name: string; content: string }> = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (
            file.name.endsWith('.md') ||
            file.name.endsWith('.txt') ||
            file.name.endsWith('.markdown')
          ) {
            const content = await file.text();
            fileData.push({
              name: file.name,
              content,
            });
          }
        }

        if (fileData.length > 0) {
          await onUploadDocuments(fileData);
        }
      } catch (err) {
        console.error('Failed to upload files:', err);
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [onUploadDocuments]
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      await onDeleteDocument(id);
    },
    [onDeleteDocument]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Documents</h3>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.markdown"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            <Upload className="mr-1 h-4 w-4" />
            {isUploading ? 'Uploading...' : 'Upload Files'}
          </Button>
          {!isCreating && (
            <Button size="sm" variant="outline" onClick={() => setIsCreating(true)}>
              <Plus className="mr-1 h-4 w-4" />
              New Document
            </Button>
          )}
        </div>
      </div>

      {isCreating && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Create Document</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Document name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Textarea
              placeholder="Enter document content in markdown..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={10}
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

      {documents.length === 0 && !isCreating && (
        <div className="rounded-lg border-2 border-dashed py-8 text-center text-muted-foreground">
          <FileText className="mx-auto mb-2 h-12 w-12 opacity-50" />
          <p>No documents in this collection.</p>
          <p className="text-sm">Upload markdown files or create a new document.</p>
        </div>
      )}

      <div className="space-y-2">
        {documents.map((doc) => (
          <Card
            key={doc.id}
            className={`cursor-pointer transition-colors hover:bg-muted/50 ${
              selectedDocument?.id === doc.id ? 'border-primary bg-muted/30' : ''
            }`}
            onClick={() => onSelectDocument(doc)}
          >
            <CardContent className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">{doc.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {doc.content.length} characters
                    </div>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={(e) => handleDelete(e, doc.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedDocument && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{selectedDocument.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 font-mono text-sm">
              {selectedDocument.content}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
