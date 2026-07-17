import type {
  MobileAccessClient,
  MobileAccessOperationResult,
  MobileAccessPairingCode,
  MobileAccessStatus,
} from '@shared/core/mobile-access';
import { mobileAccessService } from './service-instance';

export function getStatus(): MobileAccessStatus {
  return mobileAccessService.getStatus();
}

export function listBindableInterfaces() {
  return mobileAccessService.listBindableInterfaces();
}

export function generatePairingCode(): MobileAccessOperationResult<MobileAccessPairingCode> {
  return mobileAccessService.generatePairingCode();
}

export function cancelPairingCode(): MobileAccessOperationResult {
  mobileAccessService.cancelPairingCode();
  return { success: true };
}

export function listClients(): MobileAccessClient[] {
  return mobileAccessService.listClients();
}

export function revokeClient(clientId: string): MobileAccessOperationResult {
  return mobileAccessService.revokeClient(clientId);
}

export function revokeAllClients(): MobileAccessOperationResult {
  mobileAccessService.revokeAllClients();
  return { success: true };
}

export function restart(): Promise<MobileAccessOperationResult<MobileAccessStatus>> {
  return mobileAccessService.restart();
}
