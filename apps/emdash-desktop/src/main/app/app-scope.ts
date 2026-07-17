import { createScope } from '@emdash/wire/util';
import { log } from '@main/lib/logger';

export const appScope = createScope({ label: 'main', logger: log });
