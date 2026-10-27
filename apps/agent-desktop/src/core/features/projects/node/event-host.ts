import { createEventStreamHost } from '@agent/wire/live';
import { projectsWireContract } from '../api';

export const projectEvents = createEventStreamHost(projectsWireContract.events);
