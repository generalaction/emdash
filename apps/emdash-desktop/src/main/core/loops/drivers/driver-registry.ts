import { acpLoopSessionDriver } from './acp-driver';
import { ptyLoopSessionDriver } from './pty-driver';
import type { LoopSessionDriver, LoopSessionKind } from './session-driver';

const drivers = new Map<LoopSessionKind, LoopSessionDriver>([
  [acpLoopSessionDriver.kind, acpLoopSessionDriver],
  [ptyLoopSessionDriver.kind, ptyLoopSessionDriver],
]);

export function getLoopSessionDriver(kind: LoopSessionKind): LoopSessionDriver {
  return drivers.get(kind) ?? acpLoopSessionDriver;
}

export function listLoopSessionDrivers(): LoopSessionDriver[] {
  return Array.from(drivers.values());
}
