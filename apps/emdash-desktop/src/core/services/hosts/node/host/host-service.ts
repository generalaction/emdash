import { HostRef } from '@emdash/core/primitives/host/api';
import { HostConnection } from './host/connection/host-connection';

export interface HostService {
  readonly host: HostRef;
  readonly connection: HostConnection;
}
