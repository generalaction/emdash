import { eq } from 'drizzle-orm';
import type { StoreHandle } from '@primitives/sqlite-store/api';
import {
  automationDeploymentSchema,
  type AutomationDeployment,
  type AutomationId,
} from '../../api/deployment';
import type { AutomationsDb } from '../sqlite/store';
import { automationDeployments } from '../sqlite/schema';

export type StoredAutomationDeployment = {
  deployment: AutomationDeployment;
  deployedAt: number;
};

function parseDeployment(payload: string): AutomationDeployment {
  return automationDeploymentSchema.parse(JSON.parse(payload));
}

export class AutomationDeploymentStore {
  constructor(private readonly handle: StoreHandle<AutomationsDb>) {}

  /**
   * Inserts or updates a deployment. Respects `updatedAt` for last-write-wins:
   * a stale deploy (lower `updatedAt` than what's stored) is a no-op and the
   * existing stored state is returned.
   */
  upsertDeployment(
    deployment: AutomationDeployment,
    now: number
  ): StoredAutomationDeployment {
    if (!Number.isSafeInteger(now)) {
      throw new RangeError(`Deployment timestamp must be a safe integer: ${now}`);
    }
    const parsed = automationDeploymentSchema.parse(deployment);
    const payload = JSON.stringify(parsed);

    this.handle.transaction(() => {
      this.handle.db
        .insert(automationDeployments)
        .values({
          automationId: parsed.automationId,
          enabled: parsed.enabled,
          payload,
          deployedAt: now,
        })
        .onConflictDoUpdate({
          target: automationDeployments.automationId,
          set: { enabled: parsed.enabled, payload, deployedAt: now },
        })
        .run();
    });

    return { deployment: parsed, deployedAt: now };
  }

  getDeployment(id: AutomationId): AutomationDeployment | null {
    const row = this.handle.db
      .select({ payload: automationDeployments.payload })
      .from(automationDeployments)
      .where(eq(automationDeployments.automationId, id))
      .get();
    return row ? parseDeployment(row.payload) : null;
  }

  listEnabledDeployments(): AutomationDeployment[] {
    return this.handle.db
      .select({ payload: automationDeployments.payload })
      .from(automationDeployments)
      .where(eq(automationDeployments.enabled, true))
      .orderBy(automationDeployments.automationId)
      .all()
      .map(({ payload }) => parseDeployment(payload));
  }

  removeDeployment(id: AutomationId): boolean {
    return this.handle.transaction(() => {
      const result = this.handle.db
        .delete(automationDeployments)
        .where(eq(automationDeployments.automationId, id))
        .run();
      return (typeof result.changes === 'bigint' ? Number(result.changes) : result.changes) > 0;
    });
  }
}
