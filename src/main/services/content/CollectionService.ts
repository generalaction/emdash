import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDrizzleClient } from '../../db/drizzleClient';
import {
  collections,
  knowledgeDocuments,
  type CollectionRow,
  type CollectionInsert,
} from '../../db/schema';
import { log } from '../../lib/logger';

export interface Collection {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
}

function rowToCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class CollectionService {
  async create(workspaceId: string, name: string, description?: string): Promise<Collection> {
    const client = await getDrizzleClient();
    const id = uuidv4();
    const now = new Date().toISOString();

    const insert: CollectionInsert = {
      id,
      workspaceId,
      name,
      description: description ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await client.db.insert(collections).values(insert);
    log.info(`Created collection: ${id} for workspace: ${workspaceId}`);

    return {
      id,
      workspaceId,
      name,
      description,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getById(id: string): Promise<Collection | null> {
    const client = await getDrizzleClient();
    const rows = await client.db.select().from(collections).where(eq(collections.id, id));

    if (rows.length === 0) return null;
    return rowToCollection(rows[0]);
  }

  async getByWorkspaceId(workspaceId: string): Promise<Collection[]> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(collections)
      .where(eq(collections.workspaceId, workspaceId));

    // Get document counts for each collection
    const collectionsWithCounts = await Promise.all(
      rows.map(async (row) => {
        const docRows = await client.db
          .select()
          .from(knowledgeDocuments)
          .where(eq(knowledgeDocuments.collectionId, row.id));

        return {
          ...rowToCollection(row),
          documentCount: docRows.length,
        };
      })
    );

    return collectionsWithCounts;
  }

  async update(
    id: string,
    updates: Partial<{
      name: string;
      description: string;
    }>
  ): Promise<Collection | null> {
    const client = await getDrizzleClient();
    const now = new Date().toISOString();

    const updateData: Partial<CollectionInsert> = {
      updatedAt: now,
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.description !== undefined) {
      updateData.description = updates.description;
    }

    await client.db.update(collections).set(updateData).where(eq(collections.id, id));

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const client = await getDrizzleClient();
    // Documents will be cascade deleted due to FK constraint
    await client.db.delete(collections).where(eq(collections.id, id));

    log.info(`Deleted collection: ${id}`);
    return true;
  }
}

export const collectionService = new CollectionService();
