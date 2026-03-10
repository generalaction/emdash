import { and, desc, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDrizzleClient } from '../../db/drizzleClient';
import { contentOutputs, type ContentOutputRow, type ContentOutputInsert } from '../../db/schema';
import { log } from '../../lib/logger';

export interface ContentOutput {
  id: string;
  taskId: string;
  agentId: string;
  content: string;
  version: number;
  selected: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

function rowToOutput(row: ContentOutputRow): ContentOutput {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    content: row.content,
    version: row.version,
    selected: row.selected === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.createdAt,
  };
}

export class ContentOutputService {
  async create(
    taskId: string,
    agentId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<ContentOutput> {
    const client = await getDrizzleClient();
    const id = uuidv4();
    const now = new Date().toISOString();

    // Get the next version number for this task/agent combination
    const existingRows = await client.db
      .select()
      .from(contentOutputs)
      .where(and(eq(contentOutputs.taskId, taskId), eq(contentOutputs.agentId, agentId)))
      .orderBy(desc(contentOutputs.version));

    const nextVersion = existingRows.length > 0 ? existingRows[0].version + 1 : 1;

    const insert: ContentOutputInsert = {
      id,
      taskId,
      agentId,
      content,
      version: nextVersion,
      selected: 0,
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: now,
    };

    await client.db.insert(contentOutputs).values(insert);
    log.info(
      `Created content output: ${id} for task: ${taskId}, agent: ${agentId}, version: ${nextVersion}`
    );

    return {
      id,
      taskId,
      agentId,
      content,
      version: nextVersion,
      selected: false,
      metadata,
      createdAt: now,
    };
  }

  async getById(id: string): Promise<ContentOutput | null> {
    const client = await getDrizzleClient();
    const rows = await client.db.select().from(contentOutputs).where(eq(contentOutputs.id, id));

    if (rows.length === 0) return null;
    return rowToOutput(rows[0]);
  }

  async getByTaskId(taskId: string): Promise<ContentOutput[]> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(contentOutputs)
      .where(eq(contentOutputs.taskId, taskId))
      .orderBy(desc(contentOutputs.createdAt));

    return rows.map(rowToOutput);
  }

  async getByTaskAndAgent(taskId: string, agentId: string): Promise<ContentOutput[]> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(contentOutputs)
      .where(and(eq(contentOutputs.taskId, taskId), eq(contentOutputs.agentId, agentId)))
      .orderBy(desc(contentOutputs.version));

    return rows.map(rowToOutput);
  }

  async getSelectedForTask(taskId: string): Promise<ContentOutput | null> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(contentOutputs)
      .where(and(eq(contentOutputs.taskId, taskId), eq(contentOutputs.selected, 1)));

    if (rows.length === 0) return null;
    return rowToOutput(rows[0]);
  }

  async selectVersion(id: string): Promise<ContentOutput | null> {
    const client = await getDrizzleClient();

    // Get the output to find its task
    const output = await this.getById(id);
    if (!output) return null;

    // Deselect all outputs for this task
    await client.db
      .update(contentOutputs)
      .set({ selected: 0 })
      .where(eq(contentOutputs.taskId, output.taskId));

    // Select the specified output
    await client.db.update(contentOutputs).set({ selected: 1 }).where(eq(contentOutputs.id, id));

    log.info(`Selected content output: ${id} for task: ${output.taskId}`);
    return this.getById(id);
  }

  async update(
    id: string,
    updates: Partial<{
      content: string;
      metadata: Record<string, unknown>;
    }>
  ): Promise<ContentOutput | null> {
    const client = await getDrizzleClient();

    const updateData: Partial<ContentOutputInsert> = {};

    if (updates.content !== undefined) {
      updateData.content = updates.content;
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = JSON.stringify(updates.metadata);
    }

    if (Object.keys(updateData).length > 0) {
      await client.db.update(contentOutputs).set(updateData).where(eq(contentOutputs.id, id));
    }

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const client = await getDrizzleClient();
    await client.db.delete(contentOutputs).where(eq(contentOutputs.id, id));

    log.info(`Deleted content output: ${id}`);
    return true;
  }

  async deleteByTaskId(taskId: string): Promise<boolean> {
    const client = await getDrizzleClient();
    await client.db.delete(contentOutputs).where(eq(contentOutputs.taskId, taskId));

    log.info(`Deleted all content outputs for task: ${taskId}`);
    return true;
  }
}

export const contentOutputService = new ContentOutputService();
