import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { databaseService } from '../services/DatabaseService';
import { terminalSnapshotService } from '../services/TerminalSnapshotService';
import { generateSummary } from '../services/SummaryGenerationService';
import { stripAnsi, extractLastLines } from '../utils/ansiStrip';
import { getAppSettings } from '../settings';

export function registerTaskNotesIpc() {
  ipcMain.handle(
    'taskNotes:upsert',
    async (_, args: { taskId: string; type: 'manual' | 'summary'; content: string }) => {
      try {
        const id = await databaseService.upsertTaskNote(args.taskId, args.type, args.content);
        return { success: true, id };
      } catch (error) {
        log.error('Failed to upsert task note:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('taskNotes:get', async (_, taskId: string) => {
    try {
      const notes = await databaseService.getTaskNotes(taskId);
      return { success: true, notes };
    } catch (error) {
      log.error('Failed to get task notes:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('taskNotes:delete', async (_, noteId: string) => {
    try {
      await databaseService.deleteTaskNote(noteId);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete task note:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(
    'taskNotes:generateSummary',
    async (_, args: { taskId: string; ptyId: string }) => {
      try {
        const snapshot = await terminalSnapshotService.getSnapshot(args.ptyId);
        if (!snapshot?.data) {
          return { success: false, error: 'No terminal output to summarize' };
        }

        const settings = getAppSettings();
        const maxLines = settings.summary?.terminalLines ?? 500;
        const plainText = extractLastLines(stripAnsi(snapshot.data), maxLines);

        if (!plainText.trim()) {
          return { success: false, error: 'No terminal output to summarize' };
        }

        const conversations = await databaseService.getConversations(args.taskId);
        const mainConv = conversations.find((c) => c.isMain) ?? conversations[0];
        const providerId = mainConv?.provider ?? 'claude';

        const summary = await generateSummary(plainText, providerId);

        await databaseService.upsertTaskNote(args.taskId, 'summary', summary);

        return { success: true, summary };
      } catch (error) {
        log.error('Failed to generate summary:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );
}
