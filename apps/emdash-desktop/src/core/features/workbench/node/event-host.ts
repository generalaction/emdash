import { createEventStreamHost } from '@emdash/wire/live';
import { desktopHostContract } from '../api';

export const desktopHostEvents = createEventStreamHost(desktopHostContract.events);
