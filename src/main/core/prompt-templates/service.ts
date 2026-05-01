import { randomUUID } from 'node:crypto';
import { count, desc, eq, inArray } from 'drizzle-orm';
import {
  MAX_PROMPT_TEMPLATES,
  type CreatePromptTemplateInput,
  type PromptTemplate,
  type UpdatePromptTemplateInput,
} from '@shared/prompt-templates';
import type { AppDb } from '@main/db/client';
import { promptTemplates } from '@main/db/schema';

const MAX_NAME_LENGTH = 64;
const MAX_TEXT_LENGTH = 4000;

function validateName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Template name is required');
  if (trimmed.length > MAX_NAME_LENGTH)
    throw new Error(`Template name must be ${MAX_NAME_LENGTH} characters or fewer`);
}

function validateText(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Template text is required');
  if (trimmed.length > MAX_TEXT_LENGTH)
    throw new Error(`Template text must be ${MAX_TEXT_LENGTH} characters or fewer`);
}

function toModel(row: typeof promptTemplates.$inferSelect): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    text: row.text,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PromptTemplateService {
  private db: AppDb;

  constructor(database: AppDb) {
    this.db = database;
  }

  async list(): Promise<PromptTemplate[]> {
    const rows = await this.db
      .select()
      .from(promptTemplates)
      .orderBy(promptTemplates.sortOrder, promptTemplates.createdAt);
    return rows.map(toModel);
  }

  async getById(id: string): Promise<PromptTemplate | null> {
    const [row] = await this.db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, id))
      .limit(1);
    return row ? toModel(row) : null;
  }

  async create(input: CreatePromptTemplateInput): Promise<PromptTemplate> {
    validateName(input.name);
    validateText(input.text);

    const [countRow] = await this.db.select({ value: count() }).from(promptTemplates);
    if (countRow.value >= MAX_PROMPT_TEMPLATES) {
      throw new Error(`You can create up to ${MAX_PROMPT_TEMPLATES} templates`);
    }

    const [maxRow] = await this.db
      .select({ sortOrder: promptTemplates.sortOrder })
      .from(promptTemplates)
      .orderBy(desc(promptTemplates.sortOrder))
      .limit(1);
    const nextSortOrder = (maxRow?.sortOrder ?? -1) + 1;

    const id = randomUUID();
    const now = new Date().toISOString();
    const insertData = {
      id,
      name: input.name.trim(),
      text: input.text.trim(),
      sortOrder: nextSortOrder,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(promptTemplates).values(insertData);
    return toModel(insertData);
  }

  async update(id: string, input: UpdatePromptTemplateInput): Promise<PromptTemplate> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Prompt template ${id} not found`);

    if (input.name !== undefined) validateName(input.name);
    if (input.text !== undefined) validateText(input.text);

    const updates: Partial<typeof promptTemplates.$inferInsert> = {};
    if (input.name !== undefined) updates.name = input.name.trim();
    if (input.text !== undefined) updates.text = input.text.trim();
    if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;
    updates.updatedAt = new Date().toISOString();

    await this.db.update(promptTemplates).set(updates).where(eq(promptTemplates.id, id));

    return {
      ...existing,
      name: updates.name ?? existing.name,
      text: updates.text ?? existing.text,
      sortOrder: updates.sortOrder ?? existing.sortOrder,
      updatedAt: updates.updatedAt ?? existing.updatedAt,
    };
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(promptTemplates).where(eq(promptTemplates.id, id));
  }

  async reorder(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const existingRows = await this.db
      .select({ id: promptTemplates.id })
      .from(promptTemplates)
      .where(inArray(promptTemplates.id, ids));

    if (existingRows.length !== ids.length) {
      throw new Error('One or more prompt templates were not found');
    }

    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      for (let i = 0; i < ids.length; i++) {
        tx.update(promptTemplates)
          .set({ sortOrder: i, updatedAt: now })
          .where(eq(promptTemplates.id, ids[i]))
          .run();
      }
    });
  }
}
