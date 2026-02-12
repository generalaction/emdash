/**
 * Types for the Quick Open (Cmd+P) file search feature
 */

export interface FileIndexEntry {
  path: string;
  fileName: string;
  segments: string[];
  type: 'file' | 'dir';
}

export interface FuzzyMatchResult {
  matches: boolean;
  score: number;
  highlights: number[];
}

export interface SearchResult {
  entry: FileIndexEntry;
  score: number;
  highlights: number[];
}

export interface QuickOpenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFile: (path: string, line?: number) => void;
  rootPath: string;
}
