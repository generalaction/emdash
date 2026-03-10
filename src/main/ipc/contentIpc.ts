import { ipcMain } from 'electron';
import {
  contentWorkspaceService,
  brandService,
  collectionService,
  knowledgeService,
  contentOutputService,
  contentContextService,
  contentExportService,
  type KanbanColumn,
  type ExportOptions,
} from '../services/content';
import { log } from '../lib/logger';

export function registerContentIpc() {
  // ============================================================================
  // Content Workspace Handlers
  // ============================================================================

  ipcMain.handle(
    'content:workspace:create',
    async (
      _,
      args: {
        projectId: string;
        name: string;
        kanbanColumns?: KanbanColumn[];
        defaultAgents?: string[];
        metadata?: Record<string, unknown>;
      }
    ) => {
      try {
        const workspace = await contentWorkspaceService.create(args.projectId, args.name, {
          kanbanColumns: args.kanbanColumns,
          defaultAgents: args.defaultAgents,
          metadata: args.metadata,
        });
        return { success: true, data: workspace };
      } catch (error) {
        log.error('Failed to create content workspace:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:workspace:get', async (_, id: string) => {
    try {
      const workspace = await contentWorkspaceService.getById(id);
      return { success: true, data: workspace };
    } catch (error) {
      log.error('Failed to get content workspace:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:workspace:getByProject', async (_, projectId: string) => {
    try {
      const workspaces = await contentWorkspaceService.getByProjectId(projectId);
      return { success: true, data: workspaces };
    } catch (error) {
      log.error('Failed to get content workspaces:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'content:workspace:update',
    async (
      _,
      args: {
        id: string;
        name?: string;
        kanbanColumns?: KanbanColumn[];
        defaultAgents?: string[];
        metadata?: Record<string, unknown>;
      }
    ) => {
      try {
        const workspace = await contentWorkspaceService.update(args.id, {
          name: args.name,
          kanbanColumns: args.kanbanColumns,
          defaultAgents: args.defaultAgents,
          metadata: args.metadata,
        });
        return { success: true, data: workspace };
      } catch (error) {
        log.error('Failed to update content workspace:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:workspace:delete', async (_, id: string) => {
    try {
      await contentWorkspaceService.delete(id);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete content workspace:', error);
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================
  // Brand Guidelines Handlers
  // ============================================================================

  ipcMain.handle(
    'content:brand:create',
    async (
      _,
      args: {
        workspaceId: string;
        name: string;
        content: string;
        isActive?: boolean;
      }
    ) => {
      try {
        const brand = await brandService.create(
          args.workspaceId,
          args.name,
          args.content,
          args.isActive
        );
        return { success: true, data: brand };
      } catch (error) {
        log.error('Failed to create brand guideline:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:brand:get', async (_, id: string) => {
    try {
      const brand = await brandService.getById(id);
      return { success: true, data: brand };
    } catch (error) {
      log.error('Failed to get brand guideline:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:brand:getByWorkspace', async (_, workspaceId: string) => {
    try {
      const brands = await brandService.getByWorkspaceId(workspaceId);
      return { success: true, data: brands };
    } catch (error) {
      log.error('Failed to get brand guidelines:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:brand:getActive', async (_, workspaceId: string) => {
    try {
      const brand = await brandService.getActive(workspaceId);
      return { success: true, data: brand };
    } catch (error) {
      log.error('Failed to get active brand guideline:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'content:brand:update',
    async (
      _,
      args: {
        id: string;
        name?: string;
        content?: string;
        isActive?: boolean;
      }
    ) => {
      try {
        const brand = await brandService.update(args.id, {
          name: args.name,
          content: args.content,
          isActive: args.isActive,
        });
        return { success: true, data: brand };
      } catch (error) {
        log.error('Failed to update brand guideline:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:brand:delete', async (_, id: string) => {
    try {
      await brandService.delete(id);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete brand guideline:', error);
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================
  // Collection Handlers
  // ============================================================================

  ipcMain.handle(
    'content:collection:create',
    async (
      _,
      args: {
        workspaceId: string;
        name: string;
        description?: string;
      }
    ) => {
      try {
        const collection = await collectionService.create(
          args.workspaceId,
          args.name,
          args.description
        );
        return { success: true, data: collection };
      } catch (error) {
        log.error('Failed to create collection:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:collection:get', async (_, id: string) => {
    try {
      const collection = await collectionService.getById(id);
      return { success: true, data: collection };
    } catch (error) {
      log.error('Failed to get collection:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:collection:getByWorkspace', async (_, workspaceId: string) => {
    try {
      const collections = await collectionService.getByWorkspaceId(workspaceId);
      return { success: true, data: collections };
    } catch (error) {
      log.error('Failed to get collections:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'content:collection:update',
    async (
      _,
      args: {
        id: string;
        name?: string;
        description?: string;
      }
    ) => {
      try {
        const collection = await collectionService.update(args.id, {
          name: args.name,
          description: args.description,
        });
        return { success: true, data: collection };
      } catch (error) {
        log.error('Failed to update collection:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:collection:delete', async (_, id: string) => {
    try {
      await collectionService.delete(id);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete collection:', error);
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================
  // Knowledge Document Handlers
  // ============================================================================

  ipcMain.handle(
    'content:knowledge:create',
    async (
      _,
      args: {
        collectionId: string;
        name: string;
        content: string;
        metadata?: Record<string, unknown>;
      }
    ) => {
      try {
        const document = await knowledgeService.create(
          args.collectionId,
          args.name,
          args.content,
          args.metadata
        );
        return { success: true, data: document };
      } catch (error) {
        log.error('Failed to create knowledge document:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'content:knowledge:upload',
    async (
      _,
      args: {
        collectionId: string;
        documents: Array<{
          name: string;
          content: string;
          metadata?: Record<string, unknown>;
        }>;
      }
    ) => {
      try {
        const documents = await knowledgeService.uploadDocuments(args.collectionId, args.documents);
        return { success: true, data: documents };
      } catch (error) {
        log.error('Failed to upload knowledge documents:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:knowledge:get', async (_, id: string) => {
    try {
      const document = await knowledgeService.getById(id);
      return { success: true, data: document };
    } catch (error) {
      log.error('Failed to get knowledge document:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:knowledge:getByCollection', async (_, collectionId: string) => {
    try {
      const documents = await knowledgeService.getByCollectionId(collectionId);
      return { success: true, data: documents };
    } catch (error) {
      log.error('Failed to get knowledge documents:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'content:knowledge:update',
    async (
      _,
      args: {
        id: string;
        name?: string;
        content?: string;
        metadata?: Record<string, unknown>;
      }
    ) => {
      try {
        const document = await knowledgeService.update(args.id, {
          name: args.name,
          content: args.content,
          metadata: args.metadata,
        });
        return { success: true, data: document };
      } catch (error) {
        log.error('Failed to update knowledge document:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:knowledge:delete', async (_, id: string) => {
    try {
      await knowledgeService.delete(id);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete knowledge document:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:knowledge:getContextForAgent', async (_, collectionId: string) => {
    try {
      const context = await knowledgeService.getCollectionContextForAgent(collectionId);
      return { success: true, data: context };
    } catch (error) {
      log.error('Failed to get knowledge context for agent:', error);
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================
  // Content Output Handlers
  // ============================================================================

  ipcMain.handle(
    'content:output:create',
    async (
      _,
      args: {
        taskId: string;
        agentId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }
    ) => {
      try {
        const output = await contentOutputService.create(
          args.taskId,
          args.agentId,
          args.content,
          args.metadata
        );
        return { success: true, data: output };
      } catch (error) {
        log.error('Failed to create content output:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:output:get', async (_, id: string) => {
    try {
      const output = await contentOutputService.getById(id);
      return { success: true, data: output };
    } catch (error) {
      log.error('Failed to get content output:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:output:getByTask', async (_, taskId: string) => {
    try {
      const outputs = await contentOutputService.getByTaskId(taskId);
      return { success: true, data: outputs };
    } catch (error) {
      log.error('Failed to get content outputs:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'content:output:getByTaskAndAgent',
    async (_, args: { taskId: string; agentId: string }) => {
      try {
        const outputs = await contentOutputService.getByTaskAndAgent(args.taskId, args.agentId);
        return { success: true, data: outputs };
      } catch (error) {
        log.error('Failed to get content outputs:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:output:getSelected', async (_, taskId: string) => {
    try {
      const output = await contentOutputService.getSelectedForTask(taskId);
      return { success: true, data: output };
    } catch (error) {
      log.error('Failed to get selected content output:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:output:select', async (_, id: string) => {
    try {
      const output = await contentOutputService.selectVersion(id);
      return { success: true, data: output };
    } catch (error) {
      log.error('Failed to select content output:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'content:output:update',
    async (
      _,
      args: {
        id: string;
        content?: string;
        metadata?: Record<string, unknown>;
      }
    ) => {
      try {
        const output = await contentOutputService.update(args.id, {
          content: args.content,
          metadata: args.metadata,
        });
        return { success: true, data: output };
      } catch (error) {
        log.error('Failed to update content output:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:output:delete', async (_, id: string) => {
    try {
      await contentOutputService.delete(id);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete content output:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('content:output:deleteByTask', async (_, taskId: string) => {
    try {
      await contentOutputService.deleteByTaskId(taskId);
      return { success: true };
    } catch (error) {
      log.error('Failed to delete content outputs:', error);
      return { success: false, error: String(error) };
    }
  });

  // ============================================================================
  // Content Context Handlers
  // ============================================================================

  ipcMain.handle(
    'content:context:getForTask',
    async (
      _,
      args: {
        collectionId: string | null;
        includeBrief?: boolean;
        brief?: {
          topic?: string;
          audience?: string;
          keywords?: string;
          tone?: string;
          notes?: string;
        };
        template?: string;
      }
    ) => {
      try {
        const context = await contentContextService.getContextForTask(args.collectionId, {
          includeBrief: args.includeBrief,
          brief: args.brief,
          template: args.template,
        });
        return { success: true, data: context };
      } catch (error) {
        log.error('Failed to get content context for task:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle('content:context:getForWorkspace', async (_, workspaceId: string) => {
    try {
      const context = await contentContextService.getWorkspaceContext(workspaceId);
      return { success: true, data: context };
    } catch (error) {
      log.error('Failed to get content context for workspace:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'content:context:composePrompt',
    async (
      _,
      args: {
        collectionId: string | null;
        userPrompt?: string;
        role?: string;
        includeBrief?: boolean;
        brief?: {
          topic?: string;
          audience?: string;
          keywords?: string;
          tone?: string;
          notes?: string;
        };
      }
    ) => {
      try {
        const context = await contentContextService.getContextForTask(args.collectionId, {
          includeBrief: args.includeBrief,
          brief: args.brief,
        });
        const fullPrompt = contentContextService.composeFullPrompt({
          context,
          userPrompt: args.userPrompt,
          role: args.role,
        });
        return {
          success: true,
          data: {
            prompt: fullPrompt,
            context,
          },
        };
      } catch (error) {
        log.error('Failed to compose content prompt:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  // ============================================================================
  // Content Export Handlers
  // ============================================================================

  ipcMain.handle(
    'content:export:clipboard',
    async (_, args: { outputId: string; options?: ExportOptions }) => {
      try {
        const result = await contentExportService.copyToClipboard(args.outputId, args.options);
        return result;
      } catch (error) {
        log.error('Failed to copy content to clipboard:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'content:export:file',
    async (_, args: { outputId: string; options?: ExportOptions }) => {
      try {
        const result = await contentExportService.exportToFile(args.outputId, args.options);
        return result;
      } catch (error) {
        log.error('Failed to export content to file:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'content:export:folder',
    async (_, args: { taskId: string; options?: ExportOptions }) => {
      try {
        const result = await contentExportService.exportToFolder(args.taskId, args.options);
        return result;
      } catch (error) {
        log.error('Failed to export content to folder:', error);
        return { success: false, error: String(error) };
      }
    }
  );

  ipcMain.handle(
    'content:export:selectedToFile',
    async (_, args: { taskId: string; options?: ExportOptions }) => {
      try {
        const result = await contentExportService.exportSelectedToFile(args.taskId, args.options);
        return result;
      } catch (error) {
        log.error('Failed to export selected content to file:', error);
        return { success: false, error: String(error) };
      }
    }
  );
}
