import { Info } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function LinearSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [apiKey, setApiKey] = useState('');

  return (
    <SetupFormShell
      providerId="linear"
      getInput={() => apiKey.trim()}
      canSubmit={!!apiKey.trim()}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          type="password"
          placeholder="Linear API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="h-9 w-full"
          aria-label="Linear API key"
          autoFocus
        />
        <div className="bg-muted/40 rounded-md border border-dashed border-border/70 p-2">
          <div className="flex items-start gap-2">
            <Info className="text-muted-foreground mt-0.5 h-4 w-4" aria-hidden="true" />
            <div className="text-muted-foreground text-xs leading-snug">
              <p className="font-medium text-foreground">How to get a Linear API key</p>
              <ol className="mt-1 list-decimal pl-4">
                <li>Open Linear, go to Settings → Security & access → Personal API keys.</li>
                <li>Create a new token and copy the key.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </SetupFormShell>
  );
}

export default LinearSetupForm;
