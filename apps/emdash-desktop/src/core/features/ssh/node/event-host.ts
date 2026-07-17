import { createEventStreamHost } from '@emdash/wire';
import { sshContract } from '../api';

export const sshEvents = createEventStreamHost(sshContract.events);
