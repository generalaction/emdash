import { useEffect, useState } from 'react';
import type { AgentStatusKind } from '@shared/agentStatus';
import { makePtyId, type PtyIdKind } from '@shared/ptyId';
import { PROVIDER_IDS } from '@shared/providers/registry';
import { agentStatusStore } from '../lib/agentStatusStore';

const EMPTY_STATUS = 'unknown' as AgentStatusKind;

export function useConversationStatus(args: {
  statusId: string;
  ptySuffix: string;
  ptyKind: PtyIdKind;
}): AgentStatusKind {
  const { statusId, ptySuffix, ptyKind } = args;
  const [status, setStatus] = useState<AgentStatusKind>(EMPTY_STATUS);

  useEffect(
    () => agentStatusStore.subscribe(statusId, (snapshot) => setStatus(snapshot.kind)),
    [statusId]
  );

  useEffect(() => {
    const offExits = PROVIDER_IDS.map((providerId) => {
      const ptyId = makePtyId(providerId, ptyKind, ptySuffix);
      return window.electronAPI.onPtyExit(ptyId, () => {
        agentStatusStore.handlePtyExit({ ptyId });
      });
    });

    return () => {
      for (const off of offExits) off?.();
    };
  }, [ptyKind, ptySuffix]);

  return status;
}
