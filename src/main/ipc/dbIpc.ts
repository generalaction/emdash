import fs from 'node:fs';
import path from 'node:path';
import { databaseService } from '../services/DatabaseService';
import type { Conversation, Message, Project, Task } from '../services/DatabaseService';
import { createRPCController } from '../../shared/ipc/rpc';
import { log } from '../lib/logger';

export const databaseController = createRPCController({
  getProjects: (): Promise<Project[]> => databaseService.getProjects(),

  saveProject: (project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<void> =>
    databaseService.saveProject(project),

  getTasks: (projectId?: string): Promise<Task[]> => databaseService.getTasks(projectId),

  saveTask: (task: Omit<Task, 'createdAt' | 'updatedAt'>): Promise<void> =>
    databaseService.saveTask(task),

  deleteProject: (projectId: string): Promise<void> => databaseService.deleteProject(projectId),

  deleteTask: (taskId: string): Promise<void> => databaseService.deleteTask(taskId),

  archiveTask: (taskId: string): Promise<void> => databaseService.archiveTask(taskId),

  restoreTask: (taskId: string): Promise<void> => databaseService.restoreTask(taskId),

  getArchivedTasks: (projectId?: string): Promise<Task[]> =>
    databaseService.getArchivedTasks(projectId),

  saveConversation: (conversation: Omit<Conversation, 'createdAt' | 'updatedAt'>): Promise<void> =>
    databaseService.saveConversation(conversation),

  getConversations: (taskId: string): Promise<Conversation[]> =>
    databaseService.getConversations(taskId),

  getOrCreateDefaultConversation: (taskId: string): Promise<Conversation> =>
    databaseService.getOrCreateDefaultConversation(taskId),

  createConversation: (args: {
    taskId: string;
    title: string;
    provider?: string;
    isMain?: boolean;
  }): Promise<Conversation> =>
    databaseService.createConversation(args.taskId, args.title, args.provider, args.isMain),

  deleteConversation: (conversationId: string): Promise<void> =>
    databaseService.deleteConversation(conversationId),

  setActiveConversation: (args: { taskId: string; conversationId: string }): Promise<void> =>
    databaseService.setActiveConversation(args.taskId, args.conversationId),

  getActiveConversation: (taskId: string): Promise<Conversation | null> =>
    databaseService.getActiveConversation(taskId),

  reorderConversations: (args: { taskId: string; conversationIds: string[] }): Promise<void> =>
    databaseService.reorderConversations(args.taskId, args.conversationIds),

  updateConversationTitle: (args: { conversationId: string; title: string }): Promise<void> =>
    databaseService.updateConversationTitle(args.conversationId, args.title),

  saveMessage: (message: Omit<Message, 'timestamp'>): Promise<void> =>
    databaseService.saveMessage(message),

  getMessages: (conversationId: string): Promise<Message[]> =>
    databaseService.getMessages(conversationId),

  cleanupSessionDirectory: async (args: {
    taskPath: string;
    conversationId: string;
  }): Promise<void> => {
    const sessionDir = path.join(args.taskPath, '.emdash-sessions', args.conversationId);
    if (!fs.existsSync(sessionDir)) return;

    fs.rmSync(sessionDir, { recursive: true, force: true });
    log.info('Cleaned up session directory:', sessionDir);

    const parentDir = path.join(args.taskPath, '.emdash-sessions');
    try {
      if (fs.readdirSync(parentDir).length === 0) {
        fs.rmdirSync(parentDir);
        log.info('Removed empty .emdash-sessions directory');
      }
    } catch {
      // Parent directory removal is best-effort
    }
  },
});
