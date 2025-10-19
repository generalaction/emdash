import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { databaseService } from '../services/DatabaseService';

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

  ipcMain.handle('db:getWorkspaces', async (_, projectId?: string) => {
    try {
      return await databaseService.getWorkspaces(projectId);
    } catch (error) {
      log.error('Failed to get workspaces:', error);
      return [];
    }
  });

  ipcMain.handle('db:saveWorkspace', async (_, workspace: any) => {
    try {
      await databaseService.saveWorkspace(workspace);
      return { success: true };
    } catch (error) {
      log.error('Failed to save workspace:', error);
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

  // Conversation management
  ipcMain.handle('db:saveConversation', async (_, conversation: any) => {
    try {
      await databaseService.saveConversation(conversation);
      return { success: true };
    } catch (error) {
      log.error('Failed to save conversation:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:getConversations', async (_, workspaceId: string) => {
    try {
      const conversations = await databaseService.getConversations(workspaceId);
      return { success: true, conversations };
    } catch (error) {
      log.error('Failed to get conversations:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:getOrCreateDefaultConversation', async (_, workspaceId: string) => {
    try {
      const conversation = await databaseService.getOrCreateDefaultConversation(workspaceId);
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

  ipcMain.handle('db:deleteWorkspace', async (_, workspaceId: string) => {
    try {
      await databaseService.deleteWorkspace(workspaceId);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete workspace:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:updateWorkspaceLayout', async (_, workspaceId: string, layout: any) => {
    try {
      await databaseService.updateWorkspaceLayout(workspaceId, layout);
      return { success: true };
    } catch (error) {
      log.error('Failed to update workspace layout:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('db:getWorkspaceLayout', async (_, workspaceId: string) => {
    try {
      const layout = await databaseService.getWorkspaceLayout(workspaceId);
      return { success: true, layout };
    } catch (error) {
      log.error('Failed to get workspace layout:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
