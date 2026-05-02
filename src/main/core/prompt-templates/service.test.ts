import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@main/db/schema';
import { PromptTemplateService } from './service';

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  // Create the prompt_templates table manually since we're not running migrations
  sqlite.exec(`
    CREATE TABLE prompt_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0 NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE INDEX idx_prompt_templates_sort_order ON prompt_templates (sort_order);
  `);
  return db;
}

describe('PromptTemplateService', () => {
  let service: PromptTemplateService;

  beforeEach(() => {
    const db = createTestDb();
    service = new PromptTemplateService(db);
  });

  it('lists templates ordered by sortOrder', async () => {
    const t1 = await service.create({ name: 'A', text: 'text A' });
    const t2 = await service.create({ name: 'B', text: 'text B' });
    await service.reorder([t2.id, t1.id]);

    const list = await service.list();
    expect(list.map((t) => t.name)).toEqual(['B', 'A']);
  });

  it('creates a template with incremental sortOrder', async () => {
    const t1 = await service.create({ name: 'First', text: 'hello' });
    const t2 = await service.create({ name: 'Second', text: 'world' });
    expect(t1.sortOrder).toBe(0);
    expect(t2.sortOrder).toBe(1);
  });

  it('rejects empty name', async () => {
    await expect(service.create({ name: '   ', text: 'valid' })).rejects.toThrow(
      'Template name is required'
    );
  });

  it('rejects empty text', async () => {
    await expect(service.create({ name: 'valid', text: '   ' })).rejects.toThrow(
      'Template text is required'
    );
  });

  it('rejects name over 64 chars', async () => {
    await expect(service.create({ name: 'x'.repeat(65), text: 'valid' })).rejects.toThrow(
      'Template name must be 64 characters or fewer'
    );
  });

  it('rejects text over 4000 chars', async () => {
    await expect(service.create({ name: 'valid', text: 'x'.repeat(4001) })).rejects.toThrow(
      'Template text must be 4000 characters or fewer'
    );
  });

  it('updates a template', async () => {
    const t = await service.create({ name: 'Old', text: 'old text' });
    const updated = await service.update(t.id, { name: 'New', text: 'new text' });
    expect(updated.name).toBe('New');
    expect(updated.text).toBe('new text');
  });

  it('throws when updating non-existent template', async () => {
    await expect(service.update('nonexistent', { name: 'X' })).rejects.toThrow(
      'Prompt template nonexistent not found'
    );
  });

  it('deletes a template', async () => {
    const t = await service.create({ name: 'ToDelete', text: 'bye' });
    await service.delete(t.id);
    const found = await service.getById(t.id);
    expect(found).toBeNull();
  });

  it('reorders templates', async () => {
    const t1 = await service.create({ name: '1', text: 'a' });
    const t2 = await service.create({ name: '2', text: 'b' });
    const t3 = await service.create({ name: '3', text: 'c' });
    await service.reorder([t3.id, t1.id, t2.id]);

    const list = await service.list();
    expect(list.map((t) => t.name)).toEqual(['3', '1', '2']);
    expect(list[0]!.sortOrder).toBe(0);
    expect(list[1]!.sortOrder).toBe(1);
    expect(list[2]!.sortOrder).toBe(2);
  });

  it('rejects partial reorder lists', async () => {
    const t1 = await service.create({ name: '1', text: 'a' });
    await service.create({ name: '2', text: 'b' });

    await expect(service.reorder([t1.id])).rejects.toThrow(
      'Reorder request must include all prompt templates'
    );
  });

  it('rejects duplicate ids in reorder list', async () => {
    const t1 = await service.create({ name: '1', text: 'a' });
    await service.create({ name: '2', text: 'b' });

    await expect(service.reorder([t1.id, t1.id])).rejects.toThrow(
      'Reorder request contains duplicate template IDs'
    );
  });
});
