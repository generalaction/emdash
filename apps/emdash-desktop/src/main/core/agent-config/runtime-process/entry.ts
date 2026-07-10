import { pluginRegistry } from '@emdash/plugins/agents';
import { bootAgentConfigRuntimeProcess } from '@emdash/runtime/agent-config/node';

bootAgentConfigRuntimeProcess({ pluginRegistry });
