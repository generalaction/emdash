import { createEventStreamHost } from '@emdash/wire';
import { previewServersContract } from '../api';

export const previewServerEvents = createEventStreamHost(previewServersContract.events);
