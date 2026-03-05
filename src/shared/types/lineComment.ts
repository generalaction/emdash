export type LineComment = {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent?: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
};
