import { describe, expect, it } from 'vitest';
import { SETTINGS_INDEX } from '../../renderer/hooks/useSettingsSearch';
import { INTEGRATION_REGISTRY } from '../../renderer/components/integrations/registry';

describe('settings search index', () => {
  it('has an entry for every integration in the registry', () => {
    const indexedIds = new Set(SETTINGS_INDEX.map((entry) => entry.id));
    const missing = INTEGRATION_REGISTRY.filter((entry) => !indexedIds.has(entry.id)).map(
      (entry) => entry.id
    );

    expect(
      missing,
      `INTEGRATION_REGISTRY contains ids that are not present in SETTINGS_INDEX: ${missing.join(
        ', '
      )}. Add an entry to SETTINGS_INDEX in src/renderer/hooks/useSettingsSearch.ts so the new integration is searchable.`
    ).toEqual([]);
  });

  it('routes every integration entry to the integrations tab', () => {
    const integrationIds = new Set(INTEGRATION_REGISTRY.map((entry) => entry.id));
    const misrouted = SETTINGS_INDEX.filter(
      (entry) => integrationIds.has(entry.id) && entry.tabId !== 'integrations'
    );

    expect(misrouted).toEqual([]);
  });
});
