import { Button } from '@emdash/ui/react';
import { Bot, ChevronDown, MessageSquare, Settings2, TerminalSquare, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createMobileUuid } from '../browser-compat';
import { useMobileClient } from '../client/context';
import type {
  CreateOptions,
  CreateResourceRequest,
  ResourceSummary,
  TaskSummary,
} from '../client/types';
import { isTaskSelectable } from '../model';
import { BottomSheet } from './bottom-sheet';

type SessionKind = 'acp' | 'agent-terminal' | 'terminal';

const sessionKinds: Array<{
  id: SessionKind;
  label: string;
  description: string;
}> = [
  { id: 'acp', label: 'Agent chat', description: 'Structured chat with rich tool output' },
  { id: 'agent-terminal', label: 'Agent terminal', description: 'Provider’s interactive TUI' },
  { id: 'terminal', label: 'Shell terminal', description: 'A regular workspace shell' },
];

function SessionIcon({ kind }: { kind: SessionKind }) {
  if (kind === 'acp') return <MessageSquare size={20} />;
  if (kind === 'agent-terminal') return <Bot size={20} />;
  return <TerminalSquare size={20} />;
}

export function NewSessionSheet({
  open,
  task,
  initialKind = 'acp',
  onClose,
  onCreated,
}: {
  open: boolean;
  task: TaskSummary;
  initialKind?: SessionKind;
  onClose: () => void;
  onCreated: (resource: ResourceSummary) => void;
}) {
  const client = useMobileClient();
  const [kind, setKind] = useState<SessionKind>(initialKind);
  const [options, setOptions] = useState<CreateOptions>();
  const [advanced, setAdvanced] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [modelId, setModelId] = useState('');
  const [shellId, setShellId] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setAdvanced(false);
    setError('');
    void client
      .getCreateOptions(task.id)
      .then((next) => {
        setOptions(next);
        const nextAgent =
          next.defaultAgentId ?? next.agents.find((agent) => agent.installed)?.id ?? '';
        setAgentId(nextAgent);
        const agent = next.agents.find((candidate) => candidate.id === nextAgent);
        setModelId(agent?.models[0]?.id ?? '');
        setShellId(next.defaultShellId ?? next.shells[0]?.id ?? '');
        setAutoApprove(next.autoApproveByDefault);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Could not load session options.');
      });
  }, [client, initialKind, open, task.id]);

  const selectedAgent = useMemo(
    () => options?.agents.find((agent) => agent.id === agentId),
    [agentId, options]
  );
  const eligibleAgents = useMemo(
    () =>
      options?.agents.filter(
        (agent) => agent.installed && agent.interfaces.includes(kind === 'acp' ? 'acp' : 'terminal')
      ) ?? [],
    [kind, options]
  );

  useEffect(() => {
    if (kind === 'terminal' || eligibleAgents.some((agent) => agent.id === agentId)) return;
    const next = eligibleAgents[0];
    setAgentId(next?.id ?? '');
    setModelId(next?.models[0]?.id ?? '');
  }, [agentId, eligibleAgents, kind]);

  const create = async () => {
    if (!isTaskSelectable(task)) return;
    setLoading(true);
    setError('');
    try {
      const requestId = requestIdRef.current ?? createMobileUuid();
      requestIdRef.current = requestId;
      const base = { requestId, taskId: task.id };
      const request: CreateResourceRequest =
        kind === 'terminal'
          ? { ...base, kind, shellId: shellId || undefined }
          : {
              ...base,
              kind,
              agentId: agentId || undefined,
              modelId: kind === 'acp' ? modelId || undefined : undefined,
              autoApprove: kind === 'agent-terminal' ? autoApprove : undefined,
            };
      const resource = await client.createResource(request);
      onCreated(resource);
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the session.');
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    requestIdRef.current = undefined;
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      title="New session"
      description={`Start something in ${task.name}.`}
      onClose={close}
    >
      {!options && !error ? (
        <div className="sheet-loading">
          <span className="spinner" /> Loading available tools…
        </div>
      ) : (
        <div className="new-session-form">
          <div className="session-kind-grid">
            {sessionKinds.map((item) => (
              <button
                type="button"
                key={item.id}
                className="session-kind-card"
                data-selected={kind === item.id || undefined}
                onClick={() => setKind(item.id)}
              >
                <span>
                  <SessionIcon kind={item.id} />
                </span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </button>
            ))}
          </div>

          {kind !== 'terminal' && selectedAgent && (
            <div className="quick-default">
              <Zap size={16} />
              <p>
                Ready with <strong>{selectedAgent.name}</strong>
                {kind === 'acp' && selectedAgent.models[0]
                  ? ` · ${selectedAgent.models[0].name}`
                  : ''}
              </p>
            </div>
          )}

          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced((value) => !value)}
          >
            <Settings2 size={16} /> Options
            <ChevronDown size={16} data-open={advanced || undefined} />
          </button>

          {advanced && options && (
            <div className="advanced-fields">
              {kind !== 'terminal' ? (
                <>
                  <label>
                    <span>Agent</span>
                    <select
                      value={agentId}
                      onChange={(event) => {
                        const next = event.target.value;
                        setAgentId(next);
                        setModelId(
                          options.agents.find((agent) => agent.id === next)?.models[0]?.id ?? ''
                        );
                      }}
                    >
                      {eligibleAgents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {kind === 'acp' && selectedAgent && selectedAgent.models.length > 0 && (
                    <label>
                      <span>Model</span>
                      <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
                        {selectedAgent.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {kind === 'agent-terminal' && selectedAgent?.supportsAutoApprove && (
                    <label className="toggle-field">
                      <span>
                        <strong>Auto-approve</strong>
                        <small>Allow supported provider actions without confirmation.</small>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={autoApprove}
                        onChange={(event) => setAutoApprove(event.target.checked)}
                      />
                    </label>
                  )}
                </>
              ) : (
                <label>
                  <span>Shell</span>
                  <select value={shellId} onChange={(event) => setShellId(event.target.value)}>
                    {options.shells.map((shell) => (
                      <option key={shell.id} value={shell.id}>
                        {shell.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {error && (
            <p className="form-error panel-error" role="alert">
              {error}
            </p>
          )}
          <Button
            type="button"
            variant="primary"
            className="primary-action sheet-primary"
            disabled={loading || !options || (kind !== 'terminal' && !agentId)}
            onClick={create}
          >
            {loading ? <span className="spinner" /> : <SessionIcon kind={kind} />}
            {loading
              ? 'Starting…'
              : `Start ${sessionKinds.find((item) => item.id === kind)?.label}`}
          </Button>
        </div>
      )}
    </BottomSheet>
  );
}
