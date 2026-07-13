import { bootAcpRuntimeProcess } from '@emdash/core/runtimes/acp/node/process';
import { pluginRegistry } from '@emdash/plugins/agents';

bootAcpRuntimeProcess({ pluginRegistry });
