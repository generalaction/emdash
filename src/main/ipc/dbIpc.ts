import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { databaseService } from '../services/DatabaseService';
import fs from 'fs';
import path from 'path';

async function cleanupSessionDirectory(taskPath: string, conversationId: string): Promise<void> {
  try {
    const sessionDir = path.join(taskPath, '.emdash-sessions', conversationId);

    try {
      await fs.promises.stat(sessionDir);
    } catch {
      return;
    }

    try {
      await fs.promises.rm(sessionDir, { recursive: true, force: true });
      log.info('Cleaned up session directory:', sessionDir);
    } catch (error) {
      log.warn('Failed to remove session directory:', error);
      return;
    }

    const parentDir = path.join(taskPath, '.emdash-sessions');
    try {
      const entries = await fs.promises.readdir(parentDir);
      if (entries.length === 0) {
        await fs.promises.rmdir(parentDir);
        log.info('Removed empty .emdash-sessions directory');
      }
    } catch {
      // Parent directory removal is optional
    }
  } catch (error) {
    log.warn('Failed to cleanup session directory:', error);
  }
}

export function registerDatabaseIpc() {
  ipcMain.handle('db:getProjects', async () => {
    try {
      return await databaseService.getProjects();
    } catch (error) {
      log.error('Failed to get projects:', error);
      return [];
    }
  });

  ipcMain.handle('db:saveProject', async (_, project: any) => {
    try {
      await databaseService.saveProject(project);
      return { success: true };
    } catch (error) {
      log.error('Failed to save project:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:getTasks', async (_, projectId?: string) => {
    try {
      return await databaseService.getTasks(projectId);
    } catch (error) {
      log.error('Failed to get tasks:', error);
      return [];
    }
  });

  ipcMain.handle('db:saveTask', async (_, task: any) => {
    try {
      await databaseService.saveTask(task);
      return { success: true };
    } catch (error) {
      log.error('Failed to save task:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:deleteProject', async (_, projectId: string) => {
    try {
      await databaseService.deleteProject(projectId);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete project:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:saveConversation', async (_, conversation: any) => {
    try {
      await databaseService.saveConversation(conversation);
      return { success: true };
    } catch (error) {
      log.error('Failed to save conversation:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:getConversations', async (_, taskId: string) => {
    try {
      const conversations = await databaseService.getConversations(taskId);
      return { success: true, conversations };
    } catch (error) {
      log.error('Failed to get conversations:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:getOrCreateDefaultConversation', async (_, taskId: string) => {
    try {
      const conversation = await databaseService.getOrCreateDefaultConversation(taskId);
      return { success: true, conversation };
    } catch (error) {
      log.error('Failed to get or create default conversation:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:saveMessage', async (_, message: any) => {
    try {
      await databaseService.saveMessage(message);
      return { success: true };
    } catch (error) {
      log.error('Failed to save message:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:getMessages', async (_, conversationId: string) => {
    try {
      const messages = await databaseService.getMessages(conversationId);
      return { success: true, messages };
    } catch (error) {
      log.error('Failed to get messages:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:deleteConversation', async (_, conversationId: string) => {
    try {
      await databaseService.deleteConversation(conversationId);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete conversation:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(
    'db:cleanupSessionDirectory',
    async (_, args: { taskPath: string; conversationId: string }) => {
      try {
        void cleanupSessionDirectory(args.taskPath, args.conversationId);
        return { success: true };
      } catch (error) {
        log.warn('Failed to cleanup session directory:', error);
        // This is best-effort, don't fail the operation
        return { success: true };
      }
    }
  );

  ipcMain.handle('db:deleteTask', async (_, taskId: string) => {
    try {
      await databaseService.deleteTask(taskId);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete task:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:archiveTask', async (_, taskId: string) => {
    try {
      await databaseService.archiveTask(taskId);
      return { success: true };
    } catch (error) {
      log.error('Failed to archive task:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:restoreTask', async (_, taskId: string) => {
    try {
      await databaseService.restoreTask(taskId);
      return { success: true };
    } catch (error) {
      log.error('Failed to restore task:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:getArchivedTasks', async (_, projectId?: string) => {
    try {
      return await databaseService.getArchivedTasks(projectId);
    } catch (error) {
      log.error('Failed to get archived tasks:', error);
      return [];
    }
  });

  // Multi-chat support handlers
  ipcMain.handle(
    'db:createConversation',
    async (
      _,
      {
        taskId,
        title,
        provider,
        isMain,
      }: { taskId: string; title: string; provider?: string; isMain?: boolean }
    ) => {
      try {
        const conversation = await databaseService.createConversation(
          taskId,
          title,
          provider,
          isMain
        );
        return { success: true, conversation };
      } catch (error) {
        log.error('Failed to create conversation:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'db:setActiveConversation',
    async (_, { taskId, conversationId }: { taskId: string; conversationId: string }) => {
      try {
        await databaseService.setActiveConversation(taskId, conversationId);
        return { success: true };
      } catch (error) {
        log.error('Failed to set active conversation:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle('db:getActiveConversation', async (_, taskId: string) => {
    try {
      const conversation = await databaseService.getActiveConversation(taskId);
      return { success: true, conversation };
    } catch (error) {
      log.error('Failed to get active conversation:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(
    'db:reorderConversations',
    async (_, { taskId, conversationIds }: { taskId: string; conversationIds: string[] }) => {
      try {
        await databaseService.reorderConversations(taskId, conversationIds);
        return { success: true };
      } catch (error) {
        log.error('Failed to reorder conversations:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'db:updateConversationTitle',
    async (_, { conversationId, title }: { conversationId: string; title: string }) => {
      try {
        await databaseService.updateConversationTitle(conversationId, title);
        return { success: true };
      } catch (error) {
        log.error('Failed to update conversation title:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );
}
