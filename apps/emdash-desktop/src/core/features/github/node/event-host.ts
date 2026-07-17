import { createEventStreamHost } from '@emdash/wire';
import { githubContract } from '../api';

export const githubEvents = createEventStreamHost(githubContract.events);
