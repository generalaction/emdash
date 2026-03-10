import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { BrandEditor } from './BrandEditor';
import { CollectionList } from './CollectionList';
import { DocumentUploader } from './DocumentUploader';
import { useContentWorkspace } from '@/hooks/useContentWorkspace';
import { useBrand } from '@/hooks/useBrand';
import { useCollections } from '@/hooks/useCollections';
import { useKnowledgeDocs } from '@/hooks/useKnowledgeDocs';
import { Plus, Layers, FileText, Palette, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

type TabValue = 'brand' | 'knowledge';

interface ContentWorkspacePanelProps {
  projectId: string;
}

export function ContentWorkspacePanel({ projectId }: ContentWorkspacePanelProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [activeTab, setActiveTab] = useState<TabValue>('brand');

  const {
    workspaces,
    activeWorkspace,
    isLoading: isLoadingWorkspaces,
    createWorkspace,
    selectWorkspace,
  } = useContentWorkspace(projectId);

  const { brands, activeBrand, createBrand, updateBrand, deleteBrand, setActiveById } = useBrand(
    activeWorkspace?.id
  );

  const {
    collections,
    selectedCollection,
    createCollection,
    deleteCollection,
    selectCollection,
    incrementDocumentCount,
  } = useCollections(activeWorkspace?.id);

  const {
    documents,
    selectedDocument,
    createDocument,
    uploadDocuments,
    deleteDocument,
    selectDocument,
  } = useKnowledgeDocs(selectedCollection?.id);

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;

    const result = await createWorkspace(newWorkspaceName.trim());
    if (result) {
      setIsCreateDialogOpen(false);
      setNewWorkspaceName('');
    }
  };

  const handleCreateDocument = async (
    name: string,
    content: string,
    metadata?: Record<string, unknown>
  ) => {
    const result = await createDocument(name, content, metadata);
    if (result && selectedCollection) {
      incrementDocumentCount(selectedCollection.id, 1);
    }
    return result;
  };

  const handleUploadDocuments = async (files: Array<{ name: string; content: string }>) => {
    const result = await uploadDocuments(files);
    if (result && selectedCollection) {
      incrementDocumentCount(selectedCollection.id, result.length);
    }
    return result;
  };

  const handleDeleteDocument = async (id: string) => {
    const result = await deleteDocument(id);
    if (result && selectedCollection) {
      incrementDocumentCount(selectedCollection.id, -1);
    }
    return result;
  };

  if (isLoadingWorkspaces) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // No workspaces yet - show create prompt
  if (workspaces.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <Layers className="h-16 w-16 text-muted-foreground/50" />
        <div className="text-center">
          <h3 className="text-lg font-semibold">No Content Workspaces</h3>
          <p className="text-sm text-muted-foreground">
            Create a workspace to start managing your content.
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create Workspace
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Content Workspace</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <Input
                placeholder="Workspace name"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateWorkspace();
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateWorkspace}>Create</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Workspace selector */}
      <div className="flex items-center gap-2 border-b p-4">
        <Layers className="h-5 w-5 text-muted-foreground" />
        <select
          value={activeWorkspace?.id || ''}
          onChange={(e) => {
            const workspace = workspaces.find((w) => w.id === e.target.value);
            selectWorkspace(workspace || null);
          }}
          className="flex-1 rounded border bg-transparent px-2 py-1"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Content Workspace</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <Input
                placeholder="Workspace name"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateWorkspace();
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateWorkspace}>Create</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Workspace content */}
      {activeWorkspace && (
        <div className="flex flex-1 flex-col">
          {/* Tab buttons */}
          <div className="mx-4 mt-4 inline-flex h-10 w-fit items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
            <button
              onClick={() => setActiveTab('brand')}
              className={cn(
                'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
                activeTab === 'brand'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:bg-background/50'
              )}
            >
              <Palette className="h-4 w-4" />
              Brand
            </button>
            <button
              onClick={() => setActiveTab('knowledge')}
              className={cn(
                'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
                activeTab === 'knowledge'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'hover:bg-background/50'
              )}
            >
              <FolderOpen className="h-4 w-4" />
              Knowledge
            </button>
          </div>

          {/* Tab content */}
          {activeTab === 'brand' && (
            <div className="flex-1 overflow-auto p-4">
              <BrandEditor
                brands={brands}
                activeBrand={activeBrand}
                onCreateBrand={createBrand}
                onUpdateBrand={updateBrand}
                onDeleteBrand={deleteBrand}
                onSetActive={setActiveById}
              />
            </div>
          )}

          {activeTab === 'knowledge' && (
            <div className="flex-1 overflow-auto p-4">
              <div className="grid h-full grid-cols-2 gap-6">
                <div>
                  <CollectionList
                    collections={collections}
                    selectedCollection={selectedCollection}
                    onSelectCollection={selectCollection}
                    onCreateCollection={createCollection}
                    onDeleteCollection={deleteCollection}
                  />
                </div>
                <div>
                  {selectedCollection ? (
                    <DocumentUploader
                      collectionId={selectedCollection.id}
                      documents={documents}
                      onCreateDocument={handleCreateDocument}
                      onUploadDocuments={handleUploadDocuments}
                      onDeleteDocument={handleDeleteDocument}
                      onSelectDocument={selectDocument}
                      selectedDocument={selectedDocument}
                    />
                  ) : (
                    <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                      <FileText className="mb-2 h-12 w-12 opacity-50" />
                      <p>Select a collection to view documents</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
