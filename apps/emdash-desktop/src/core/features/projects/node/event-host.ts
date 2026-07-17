import { createEventStreamHost } from '@emdash/wire';
import { projectsWireContract } from '../api';

export const projectEvents = createEventStreamHost(projectsWireContract.events);
