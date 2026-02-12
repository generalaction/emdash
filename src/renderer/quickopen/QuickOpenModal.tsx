/**
 * Quick Open Modal - Cmd+P file search
 * VSCode-like fuzzy file search interface
 * Uses createPortal pattern (same as CommandPalette) for reliable rendering
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFileIndex } from '@/hooks/useFileIndex';
import { FileIndexManager } from './FileIndexManager';
import type { QuickOpenModalProps, SearchResult } from './types';

export function QuickOpenModal({
  isOpen,
  onClose,
  onSelectFile,
  rootPath,
}: QuickOpenModalProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get file list from existing index
  const { items, loading, error } = useFileIndex(rootPath);

  console.log('[QuickOpen] rootPath:', rootPath, 'items:', items.length, 'loading:', loading, 'error:', error);

  // Build index manager
  const indexManager = useMemo(() => {
    const mgr = new FileIndexManager();
    if (items.length > 0) {
      mgr.buildIndex(items);
      mgr.setRootPath(rootPath);
    }
    console.log('[QuickOpen] Index built, size:', mgr.size, 'from', items.length, 'items');
    return mgr;
  }, [items, rootPath]);

  // Search results — strip :line suffix before searching
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const { path: searchQuery } = indexManager.parseQuery(query);
    const r = indexManager.search(searchQuery, 50);
    console.log('[QuickOpen] Search:', JSON.stringify(query), '→ searchQuery:', JSON.stringify(searchQuery), '→ results:', r.length);
    return r;
  }, [query, indexManager]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready after portal render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const el = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleClose = useCallback(() => {
    setQuery('');
    setSelectedIndex(0);
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const result = results[selectedIndex];
        if (result) {
          const parsed = indexManager.parseQuery(query);
          onSelectFile(result.entry.path, parsed.line);
          handleClose();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    },
    [results, selectedIndex, query, indexManager, onSelectFile, handleClose]
  );

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      onSelectFile(result.entry.path);
      handleClose();
    },
    [onSelectFile, handleClose]
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="mx-4 w-full max-w-2xl overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="border-b border-border/60 px-4">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search files by name... (e.g., 'index.ts' or 'index.ts:120')"
            className="h-12 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading files...
            </div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-destructive">{error}</div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {query ? 'No files found' : 'Type to search files...'}
            </div>
          ) : (
            <div className="py-1">
              {results.map((result, i) => (
                <ResultItem
                  key={result.entry.path}
                  result={result}
                  selected={i === selectedIndex}
                  onClick={() => handleResultClick(result)}
                  dataIndex={i}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && (
          <div className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
            {indexManager.size} files indexed
            {query && results.length > 0 && ` · ${results.length} matches`}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

interface ResultItemProps {
  result: SearchResult;
  selected: boolean;
  onClick: () => void;
  dataIndex: number;
}

function ResultItem({ result, selected, onClick, dataIndex }: ResultItemProps) {
  const { entry } = result;

  // Split path into directory and filename
  const parts = entry.path.split('/');
  const fileName = parts.pop() || '';
  const directory = parts.length > 0 ? parts.join('/') + '/' : '';

  return (
    <div
      data-index={dataIndex}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors',
        selected ? 'bg-accent' : 'hover:bg-accent/50'
      )}
    >
      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0 text-sm">
        <div className="truncate">
          <span className="text-muted-foreground">{directory}</span>
          <span className="font-medium">{fileName}</span>
        </div>
      </div>
    </div>
  );
}
