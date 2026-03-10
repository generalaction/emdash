import { and, eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDrizzleClient } from '../../db/drizzleClient';
import {
  brandGuidelines,
  type BrandGuidelineRow,
  type BrandGuidelineInsert,
} from '../../db/schema';
import { log } from '../../lib/logger';

export interface BrandGuideline {
  id: string;
  workspaceId: string;
  name: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function rowToBrand(row: BrandGuidelineRow): BrandGuideline {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    content: row.content,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class BrandService {
  async create(
    workspaceId: string,
    name: string,
    content: string,
    isActive: boolean = true
  ): Promise<BrandGuideline> {
    const client = await getDrizzleClient();
    const id = uuidv4();
    const now = new Date().toISOString();

    // If this brand is active, deactivate others in the same workspace
    if (isActive) {
      await client.db
        .update(brandGuidelines)
        .set({ isActive: 0, updatedAt: now })
        .where(eq(brandGuidelines.workspaceId, workspaceId));
    }

    const insert: BrandGuidelineInsert = {
      id,
      workspaceId,
      name,
      content,
      isActive: isActive ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    };

    await client.db.insert(brandGuidelines).values(insert);
    log.info(`Created brand guideline: ${id} for workspace: ${workspaceId}`);

    return {
      id,
      workspaceId,
      name,
      content,
      isActive,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getById(id: string): Promise<BrandGuideline | null> {
    const client = await getDrizzleClient();
    const rows = await client.db.select().from(brandGuidelines).where(eq(brandGuidelines.id, id));

    if (rows.length === 0) return null;
    return rowToBrand(rows[0]);
  }

  async getByWorkspaceId(workspaceId: string): Promise<BrandGuideline[]> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(brandGuidelines)
      .where(eq(brandGuidelines.workspaceId, workspaceId));

    return rows.map(rowToBrand);
  }

  async getActive(workspaceId: string): Promise<BrandGuideline | null> {
    const client = await getDrizzleClient();
    const rows = await client.db
      .select()
      .from(brandGuidelines)
      .where(and(eq(brandGuidelines.workspaceId, workspaceId), eq(brandGuidelines.isActive, 1)));

    if (rows.length === 0) return null;
    return rowToBrand(rows[0]);
  }

  async update(
    id: string,
    updates: Partial<{
      name: string;
      content: string;
      isActive: boolean;
    }>
  ): Promise<BrandGuideline | null> {
    const client = await getDrizzleClient();
    const now = new Date().toISOString();

    // Get the current brand to know its workspace
    const current = await this.getById(id);
    if (!current) return null;

    // If activating this brand, deactivate others in the same workspace
    if (updates.isActive === true) {
      await client.db
        .update(brandGuidelines)
        .set({ isActive: 0, updatedAt: now })
        .where(eq(brandGuidelines.workspaceId, current.workspaceId));
    }

    const updateData: Partial<BrandGuidelineInsert> = {
      updatedAt: now,
    };

    if (updates.name !== undefined) {
      updateData.name = updates.name;
    }
    if (updates.content !== undefined) {
      updateData.content = updates.content;
    }
    if (updates.isActive !== undefined) {
      updateData.isActive = updates.isActive ? 1 : 0;
    }

    await client.db.update(brandGuidelines).set(updateData).where(eq(brandGuidelines.id, id));

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const client = await getDrizzleClient();
    await client.db.delete(brandGuidelines).where(eq(brandGuidelines.id, id));

    log.info(`Deleted brand guideline: ${id}`);
    return true;
  }

  /**
   * Format brand guidelines for agent context injection
   */
  formatForAgent(brand: BrandGuideline): string {
    return `<brand_guidelines>
<name>${brand.name}</name>
<content>
${brand.content}
</content>
</brand_guidelines>`;
  }
}

export const brandService = new BrandService();
