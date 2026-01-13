import React, { useState } from 'react';
import { Repo } from '../types';
import { useToast } from '../hooks/use-toast';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';

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
          <Label className="mb-2 block text-sm font-medium text-muted-foreground">
            Agent
          </Label>
          <RadioGroup
            value={provider}
            onValueChange={(value: string) => setProvider(value as 'claude-code' | 'openai-agents')}
            className="flex gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="claude-code" id="provider-claude" />
              <Label htmlFor="provider-claude" className="cursor-pointer font-normal">
                Claude Code
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="openai-agents" id="provider-openai" />
              <Label htmlFor="provider-openai" className="cursor-pointer font-normal">
                OpenAI Agents
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div>
          <Label className="mb-2 block text-sm font-medium text-muted-foreground">Prompt</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want the coding agents to do..."
            className="h-32"
            required
          />
        </div>

        <div>
          <Label className="mb-2 block text-sm font-medium text-muted-foreground">
            Number of Agents
          </Label>
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
          <Label className="mb-2 block text-sm font-medium text-muted-foreground">
            Base Branch
          </Label>
          <Input
            type="text"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
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
