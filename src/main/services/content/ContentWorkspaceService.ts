import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDrizzleClient } from '../../db/drizzleClient';
import {
  contentWorkspaces,
  type ContentWorkspaceRow,
  type ContentWorkspaceInsert,
} from '../../db/schema';
import { log } from '../../lib/logger';

export interface ContentWorkspace {
  id: string;
  projectId: string;
  name: string;
  kanbanColumns: KanbanColumn[];
  defaultAgents: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanColumn {
  id: string;
  name: string;
  status: string;
}

const DEFAULT_KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', name: 'Backlog', status: 'backlog' },
  { id: 'research', name: 'Research', status: 'research' },
  { id: 'writing', name: 'Writing', status: 'writing' },
  { id: 'review', name: 'Review', status: 'review' },
  { id: 'ready', name: 'Ready', status: 'ready' },
];

function rowToWorkspace(row: ContentWorkspaceRow): ContentWorkspace {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    kanbanColumns: JSON.parse(row.kanbanColumns) as KanbanColumn[],
    defaultAgents: row.defaultAgents ? JSON.parse(row.defaultAgents) : [],
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ContentWorkspaceService {
  async create(
    projectId: string,
    name: string,
    options?: {
      kanbanColumns?: KanbanColumn[];
      defaultAgents?: string[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<ContentWorkspace> {
    const client = await getDrizzleClient();
    const id = uuidv4();
    const now = new Date().toISOString();

    const insert: ContentWorkspaceInsert = {
      id,
      projectId,
      name,
      kanbanColumns: JSON.stringify(options?.kanbanColumns ?? DEFAULT_KANBAN_COLUMNS),
      defaultAgents: options?.defaultAgents ? JSON.stringify(options.defaultAgents) : null,
      metadata: options?.metadata ? JSON.stringify(options.metadata) : null,
      createdAt: now,
      updatedAt: now,
    };

    await client.db.insert(contentWorkspaces).values(insert);
    log.info(`Created content workspace: ${id} for project: ${projectId}`);

    return {
      id,
      projectId,
      name,
      kanbanColumns: options?.kanbanColumns ?? DEFAULT_KANBAN_COLUMNS,
      defaultAgents: options?.defaultAgents ?? [],
      metadata: options?.metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getById(id: string): Promise<ContentWorkspace | null> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(contentWorkspaces)
      .where(eq(contentWorkspaces.id, id));

    if (rows.length === 0) return null;
    return rowToWorkspace(rows[0]);
  }

  async getByProjectId(projectId: string): Promise<ContentWorkspace[]> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(contentWorkspaces)
      .where(eq(contentWorkspaces.projectId, projectId));

    return rows.map(rowToWorkspace);
  }

  async update(
    id: string,
    updates: Partial<{
      name: string;
      kanbanColumns: KanbanColumn[];
      defaultAgents: string[];
      metadata: Record<string, unknown>;
    }>
  ): Promise<ContentWorkspace | null> {
    const client = await getDrizzleClient();
    const now = new Date().toISOString();

    const updateData: Partial<ContentWorkspaceInsert> = {
      updatedAt: now,
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.kanbanColumns !== undefined) {
      updateData.kanbanColumns = JSON.stringify(updates.kanbanColumns);
    }
    if (updates.defaultAgents !== undefined) {
      updateData.defaultAgents = JSON.stringify(updates.defaultAgents);
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = JSON.stringify(updates.metadata);
    }

    await client.db.update(contentWorkspaces).set(updateData).where(eq(contentWorkspaces.id, id));

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const client = await getDrizzleClient();
    const result = await client.db.delete(contentWorkspaces).where(eq(contentWorkspaces.id, id));

    log.info(`Deleted content workspace: ${id}`);
    return true;
  }
}

export const contentWorkspaceService = new ContentWorkspaceService();
