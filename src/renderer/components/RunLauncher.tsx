import React, { useState } from 'react';
import { Repo } from '../types';
import { useToast } from '../hooks/use-toast';

interface RunLauncherProps {
  repo: Repo;
  onCreateRun: (config: any) => void;
  onCancel: () => void;
}

const RunLauncher: React.FC<RunLauncherProps> = ({ repo, onCreateRun, onCancel }) => {
  const { toast } = useToast();
  const [provider, setProvider] = useState<'claude-code' | 'openai-agents'>('claude-code');
  const [prompt, setPrompt] = useState('');
  const [numAgents, setNumAgents] = useState(1);
  const [baseBranch, setBaseBranch] = useState(repo.defaultBranch);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!prompt.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Please enter a prompt',
        variant: 'destructive',
      });
      return;
    }

    onCreateRun({
      provider,
      prompt: prompt.trim(),
      numAgents,
      baseBranch,
    });
  };

  return (
    <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-xl font-semibold text-white">Start New Run</h3>
        <button className="text-xl text-muted-foreground hover:text-white" onClick={onCancel}>
          ×
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-muted-foreground">
            AI Provider
          </label>
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                value="claude-code"
                checked={provider === 'claude-code'}
                onChange={(e) => setProvider(e.target.value as 'claude-code')}
                className="mr-2"
              />
              <span className="text-white">Claude Code</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                value="openai-agents"
                checked={provider === 'openai-agents'}
                onChange={(e) => setProvider(e.target.value as 'openai-agents')}
                className="mr-2"
              />
              <span className="text-white">OpenAI Agents</span>
            </label>
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-muted-foreground">Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want the coding agents to do..."
            className="h-32 w-full rounded border border-border bg-muted p-3 text-white placeholder-gray-400 focus:border-blue-500 focus:outline-none"
            required
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-muted-foreground">
            Number of Agents
          </label>
          <select
            value={numAgents}
            onChange={(e) => setNumAgents(parseInt(e.target.value))}
            className="w-full rounded border border-border bg-muted p-3 text-white focus:border-blue-500 focus:outline-none"
          >
            <option value={1}>1 Agent</option>
            <option value={2}>2 Agents</option>
            <option value={3}>3 Agents</option>
            <option value={4}>4 Agents</option>
            <option value={5}>5 Agents</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-muted-foreground">
            Base Branch
          </label>
          <input
            type="text"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            className="w-full rounded border border-border bg-muted p-3 text-white focus:border-blue-500 focus:outline-none"
            placeholder="main"
          />
        </div>

        <div className="rounded bg-muted p-3">
          <div className="text-sm text-muted-foreground">
            <strong>Repository:</strong> {repo.path.split('/').pop()}
          </div>
          <div className="text-sm text-muted-foreground">
            <strong>Origin:</strong> {repo.origin}
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            className="flex-1 rounded bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700"
          >
            Start Run
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="hover:bg-muted0 rounded bg-muted px-4 py-3 text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default RunLauncher;
