import { useEffect, useState, useCallback } from 'react';
import type { IntegrationStatusMap } from '../../shared/integrations/types';

const DEFAULT_STATUS: IntegrationStatusMap = {
  github: false,
  linear: false,
  jira: false,
  gitlab: false,
  plain: false,
  forgejo: false,
  sentry: false,
};

/**
 * Hook to fetch integration connection statuses from the main process.
 * Returns a map of integration IDs to connected booleans.
 */
export function useIntegrationStatusMap(): {
  statuses: IntegrationStatusMap;
  isLoading: boolean;
  refresh: () => void;
} {
  const [statuses, setStatuses] = useState<IntegrationStatusMap>(DEFAULT_STATUS);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await window.electronAPI.integrationsStatusMap();
      if (result?.success && result.data) {
        setStatuses(result.data);
      }
    } catch {
      // Keep current statuses on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { statuses, isLoading, refresh };
}
