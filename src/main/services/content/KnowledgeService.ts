import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDrizzleClient } from '../../db/drizzleClient';
import {
  knowledgeDocuments,
  type KnowledgeDocumentRow,
  type KnowledgeDocumentInsert,
} from '../../db/schema';
import { log } from '../../lib/logger';

export interface KnowledgeDocument {
  id: string;
  collectionId: string;
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function rowToDocument(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    collectionId: row.collectionId,
    name: row.name,
    content: row.content,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class KnowledgeService {
  async create(
    collectionId: string,
    name: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<KnowledgeDocument> {
    const client = await getDrizzleClient();
    const id = uuidv4();
    const now = new Date().toISOString();

    const insert: KnowledgeDocumentInsert = {
      id,
      collectionId,
      name,
      content,
      metadata: metadata ? JSON.stringify(metadata) : null,
      createdAt: now,
      updatedAt: now,
    };

    await client.db.insert(knowledgeDocuments).values(insert);
    log.info(`Created knowledge document: ${id} in collection: ${collectionId}`);

    return {
      id,
      collectionId,
      name,
      content,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Upload multiple markdown documents to a collection
   */
  async uploadDocuments(
    collectionId: string,
    documents: Array<{ name: string; content: string; metadata?: Record<string, unknown> }>
  ): Promise<KnowledgeDocument[]> {
    const results: KnowledgeDocument[] = [];

    for (const doc of documents) {
      const created = await this.create(collectionId, doc.name, doc.content, doc.metadata);
      results.push(created);
    }

    log.info(`Uploaded ${results.length} documents to collection: ${collectionId}`);
    return results;
  }

  async getById(id: string): Promise<KnowledgeDocument | null> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, id));

    if (rows.length === 0) return null;
    return rowToDocument(rows[0]);
  }

  async getByCollectionId(collectionId: string): Promise<KnowledgeDocument[]> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.collectionId, collectionId));

    return rows.map(rowToDocument);
  }

  async update(
    id: string,
    updates: Partial<{
      name: string;
      content: string;
      metadata: Record<string, unknown>;
    }>
  ): Promise<KnowledgeDocument | null> {
    const client = await getDrizzleClient();
    const now = new Date().toISOString();

    const updateData: Partial<KnowledgeDocumentInsert> = {
      updatedAt: now,
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.content !== undefined) {
      updateData.content = updates.content;
    }
    if (updates.metadata !== undefined) {
      updateData.metadata = JSON.stringify(updates.metadata);
    }

    await client.db.update(knowledgeDocuments).set(updateData).where(eq(knowledgeDocuments.id, id));

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const client = await getDrizzleClient();
    await client.db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));

    log.info(`Deleted knowledge document: ${id}`);
    return true;
  }

  /**
   * Format all documents in a collection for agent context injection
   */
  formatCollectionForAgent(documents: KnowledgeDocument[]): string {
    if (documents.length === 0) {
      return '';
    }

    const formattedDocs = documents
      .map(
        (doc) => `<document name="${doc.name}">
${doc.content}
</document>`
      )
      .join('\n\n');

    return `<knowledge_documents>
${formattedDocs}
</knowledge_documents>`;
  }

  /**
   * Get all documents in a collection and format them for agent context
   */
  async getCollectionContextForAgent(collectionId: string): Promise<string> {
    const documents = await this.getByCollectionId(collectionId);
    return this.formatCollectionForAgent(documents);
  }
}

export const knowledgeService = new KnowledgeService();
