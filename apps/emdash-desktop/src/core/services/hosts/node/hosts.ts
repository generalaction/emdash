import { HostRef } from '@emdash/core/primitives/host/api';
import { type HostService } from './host-services';

export interface Hosts {
  get(host: HostRef): HostService | undefined;
}
