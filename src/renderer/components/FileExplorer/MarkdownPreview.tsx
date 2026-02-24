import React from 'react';
import { MarkdownRenderer } from '../ui/markdown-renderer';

interface MarkdownPreviewProps {
  content: string;
  /** Root path for resolving relative image paths (e.g. taskPath / worktree root) */
  rootPath?: string;
  /** Directory of the markdown file, relative to rootPath */
  fileDir?: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, rootPath, fileDir }) => {
  return (
    <div className="flex flex-1 overflow-auto bg-background">
      <MarkdownRenderer
        content={content}
        variant="full"
        className="w-full max-w-3xl px-8 py-8"
        rootPath={rootPath}
        fileDir={fileDir}
      />
    </div>
  );
};
