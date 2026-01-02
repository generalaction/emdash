import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { databaseService } from '../services/DatabaseService';
import type { LineCommentRow } from '../db/schema';

export function registerLineCommentsIpc() {
  ipcMain.handle('lineComments:create', async (_, input) => {
    try {
      const id = await databaseService.saveLineComment(input);
      return { success: true, id };
    } catch (error) {
      log.error('Failed to create line comment:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('lineComments:get', async (_, args: { taskId: string; filePath?: string }) => {
    try {
      const comments = await databaseService.getLineComments(args.taskId, args.filePath);
      return { success: true, comments };
    } catch (error) {
      log.error('Failed to get line comments:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('lineComments:update', async (_, input: { id: string; content: string }) => {
    try {
      await databaseService.updateLineComment(input.id, input.content);
      return { success: true };
    } catch (error) {
      log.error('Failed to update line comment:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('lineComments:delete', async (_, id: string) => {
    try {
      await databaseService.deleteLineComment(id);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete line comment:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('lineComments:getFormatted', async (_, taskId: string) => {
    try {
      const comments = await databaseService.getLineComments(taskId);
      const formatted = formatCommentsForAgent(comments);
      return { success: true, formatted };
    } catch (error) {
      log.error('Failed to format line comments:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('lineComments:markSent', async (_, commentIds: string[]) => {
    try {
      await databaseService.markCommentsSent(commentIds);
      return { success: true };
    } catch (error) {
      log.error('Failed to mark comments as sent:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('lineComments:getUnsent', async (_, taskId: string) => {
    try {
      const comments = await databaseService.getUnsentComments(taskId);
      return { success: true, comments };
    } catch (error) {
      log.error('Failed to get unsent comments:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}

function formatCommentsForAgent(comments: LineCommentRow[]): string {
  if (!comments.length) return '';

  const byFile = new Map<string, LineCommentRow[]>();
  for (const c of comments) {
    const existing = byFile.get(c.filePath) ?? [];
    existing.push(c);
    byFile.set(c.filePath, existing);
  }

  const sections: string[] = ['<user_comments>'];
  for (const [filePath, fileComments] of byFile) {
    sections.push(`  <file path="${filePath}">`);
    for (const c of fileComments.sort((a, b) => a.lineNumber - b.lineNumber)) {
      const side = c.side === 'original' ? 'deleted' : 'current';
      sections.push(`    <comment line="${c.lineNumber}" side="${side}">${c.content}</comment>`);
    }
    sections.push('  </file>');
  }
  sections.push('</user_comments>');
  return sections.join('\n');
}
