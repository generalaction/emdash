import React, { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FileIcon } from './FileIcons';
interface FileSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (filePath: string) => void;
  rootPath: string;
  connectionId?: string | null;
  remotePath?: string | null;
}
export const FileSearchModal: React.FC<FileSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectFile,
  rootPath,
  connectionId,
  remotePath,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<Array<{ name: string; path: string; type: string }>>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Fetch files when modal opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchFiles = async () => {
      const opts: any = { includeDirs: true };
      if (connectionId && remotePath) {
        opts.connectionId = connectionId;
        opts.remotePath = remotePath;
      }

      const result = await window.electronAPI.fsList(rootPath, opts);
      if (result.success && result.items) {
        const fileList = result.items
          .filter((item: any) => item && item.path && item.type)
          .map((item: any) => ({
            name: item.path.split('/').pop() || item.path,
            path: item.path,
            type: item.type,
          }));
        setFiles(fileList);
      }
    };

    fetchFiles();
  }, [isOpen, rootPath, connectionId, remotePath]);
  // Filter files based on search query (fuzzy match)
  const filteredFiles = searchQuery
    ? files.filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : files.slice(0, 50); // Show first 50 if no search
  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredFiles.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredFiles[selectedIndex]) {
          onSelectFile(filteredFiles[selectedIndex].path);
          onClose();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredFiles, selectedIndex, onClose, onSelectFile]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-lg border border-border bg-popover shadow-lg">
        {/* Search Input */}
        <div className="flex items-center border-b border-border px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search files..."
            className="border-0 focus-visible:ring-0"
            autoFocus
          />
          <button onClick={onClose} className="rounded p-1 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-1">
          {filteredFiles.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No files found</div>
          ) : (
            filteredFiles.map((file, index) => (
              <div
                key={file.path}
                onClick={() => {
                  onSelectFile(file.path);
                  onClose();
                }}
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 ${
                  index === selectedIndex ? 'bg-accent' : 'hover:bg-accent'
                }`}
              >
                <FileIcon filename={file.name} isDirectory={file.type === 'directory'} size={16} />
                <span className="text-sm">{file.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{file.path}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
