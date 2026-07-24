import { createEventStreamHost } from '@emdash/wire';
import { tasksWireContract } from '../api';

export const taskEvents = createEventStreamHost(tasksWireContract.events);
