import { createEventStreamHost } from '@emdash/wire';
import { desktopHostContract } from '../api';

export const desktopHostEvents = createEventStreamHost(desktopHostContract.events);
