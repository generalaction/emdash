import { createRPCController } from '@shared/lib/ipc/rpc';
import {
  cancelPairingCode,
  generatePairingCode,
  getStatus,
  listBindableInterfaces,
  listClients,
  restart,
  revokeAllClients,
  revokeClient,
} from './operations';

export const mobileAccessController = createRPCController({
  getStatus,
  listBindableInterfaces,
  generatePairingCode,
  cancelPairingCode,
  listClients,
  revokeClient,
  revokeAllClients,
  restart,
});
