import { eq } from 'drizzle-orm';
import { getDrizzleClient } from './drizzleClient';
import {
  sshConnections,
  projects,
  type SshConnectionRow,
  type SshConnectionInsert,
} from './schema';

export class SshRepository {
  private static instance: SshRepository;

  static getInstance(): SshRepository {
    if (!SshRepository.instance) {
      SshRepository.instance = new SshRepository();
    }
    return SshRepository.instance;
  }

  async createConnection(
    data: Omit<SshConnectionInsert, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<SshConnectionRow> {
    const { db } = await getDrizzleClient();
    const id = `ssh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const result = await db
      .insert(sshConnections)
      .values({
        ...data,
        id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();

    return result[0];
  }

  async getConnection(id: string): Promise<SshConnectionRow | undefined> {
    const { db } = await getDrizzleClient();
    const result = await db.select().from(sshConnections).where(eq(sshConnections.id, id));
    return result[0];
  }

  async getAllConnections(): Promise<SshConnectionRow[]> {
    const { db } = await getDrizzleClient();
    return db.select().from(sshConnections);
  }

  async updateConnection(
    id: string,
    data: Partial<SshConnectionInsert>
  ): Promise<SshConnectionRow> {
    const { db } = await getDrizzleClient();
    const result = await db
      .update(sshConnections)
      .set({
        ...data,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sshConnections.id, id))
      .returning();
    return result[0];
  }

  async deleteConnection(id: string): Promise<void> {
    const { db } = await getDrizzleClient();

    // First update any projects using this connection
    await db
      .update(projects)
      .set({ sshConnectionId: null, isRemote: 0 })
      .where(eq(projects.sshConnectionId, id));

    // Then delete the connection
    await db.delete(sshConnections).where(eq(sshConnections.id, id));
  }

  async getProjectsForConnection(connectionId: string): Promise<string[]> {
    const { db } = await getDrizzleClient();
    const result = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.sshConnectionId, connectionId));
    return result.map((r) => r.id);
  }
}
