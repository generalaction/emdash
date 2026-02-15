import React from 'react';
import { MarkdownRenderer } from '../ui/markdown-renderer';

interface MarkdownPreviewProps {
  content: string;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content }) => {
  return (
    <div className="flex flex-1 overflow-auto bg-background">
      <MarkdownRenderer content={content} variant="full" className="w-full max-w-3xl px-8 py-8" />
    </div>
  );
};
