import { useEffect, useState } from 'react';

export function useWorkspaceProviderState(
  selectedProjectId: string | undefined,
  isWorkspaceProviderEnabled: boolean
): { useBYOI: boolean; setUseBYOI: (value: boolean) => void } {
  const [useBYOI, setUseBYOI] = useState(false);

  useEffect(() => setUseBYOI(false), [selectedProjectId]);
  useEffect(() => {
    if (!isWorkspaceProviderEnabled) setUseBYOI(false);
  }, [isWorkspaceProviderEnabled]);

  return { useBYOI, setUseBYOI };
}
