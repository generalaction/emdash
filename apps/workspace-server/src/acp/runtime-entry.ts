import { pluginRegistry } from '@emdash/plugins/agents';
import { bootAcpRuntimeProcess } from '@emdash/runtime/acp/node';

bootAcpRuntimeProcess({ pluginRegistry });
