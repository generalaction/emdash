import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { databaseService } from '../services/DatabaseService';

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
}
