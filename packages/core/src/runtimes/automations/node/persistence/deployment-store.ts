import type { StoreHandle } from '@primitives/sqlite-store/api';
import { eq } from 'drizzle-orm';
import {
  automationDeploymentSchema,
  type AutomationDeployment,
  type AutomationId,
} from '../../api/deployment';
import { parseDeploymentPayload, serializeDeploymentPayload } from './payload-codecs';
import { automationDeployments } from './schema';
import type { AutomationsDb } from './store';

export type StoredAutomationDeployment = {
  deployment: AutomationDeployment;
  deployedAt: number;
};

export class AutomationDeploymentStore {
  constructor(private readonly handle: StoreHandle<AutomationsDb>) {}

  upsertDeployment(deployment: AutomationDeployment, now: number): StoredAutomationDeployment {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new RangeError(`Deployment timestamp must be a non-negative safe integer: ${now}`);
    }
    const parsed = automationDeploymentSchema.parse(deployment);
    const payload = serializeDeploymentPayload(parsed);

    return this.handle.transaction(() => {
      const existing = this.handle.db
        .select({
          payload: automationDeployments.payload,
          deployedAt: automationDeployments.deployedAt,
        })
        .from(automationDeployments)
        .where(eq(automationDeployments.automationId, parsed.automationId))
        .get();
      if (existing) {
        const current = parseDeploymentPayload(existing.payload);
        if (parsed.revision <= current.revision) {
          return { deployment: current, deployedAt: existing.deployedAt };
        }
      }

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
      return { deployment: parsed, deployedAt: now };
    });
  }

  getDeployment(id: AutomationId): AutomationDeployment | null {
    const row = this.handle.db
      .select({ payload: automationDeployments.payload })
      .from(automationDeployments)
      .where(eq(automationDeployments.automationId, id))
      .get();
    return row ? parseDeploymentPayload(row.payload) : null;
  }

  listEnabledDeployments(): AutomationDeployment[] {
    return this.handle.db
      .select({ payload: automationDeployments.payload })
      .from(automationDeployments)
      .where(eq(automationDeployments.enabled, true))
      .orderBy(automationDeployments.automationId)
      .all()
      .map(({ payload }) => parseDeploymentPayload(payload));
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
