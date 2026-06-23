import { Info } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function PlainSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [apiKey, setApiKey] = useState('');

  return (
    <SetupFormShell
      providerId="plain"
      getInput={() => apiKey.trim()}
      canSubmit={!!apiKey.trim()}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          type="password"
          placeholder="Plain API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="h-9 w-full"
          aria-label="Plain API key"
          autoFocus
        />
        <div className="bg-muted/40 rounded-md border border-dashed border-border/70 p-2">
          <div className="flex items-start gap-2">
            <Info className="text-muted-foreground mt-0.5 h-4 w-4" aria-hidden="true" />
            <div className="text-muted-foreground text-xs leading-snug">
              <p className="font-medium text-foreground">How to get a Plain API key</p>
              <ol className="mt-1 list-decimal pl-4">
                <li>Open Plain, go to Settings → API keys.</li>
                <li>Create a new API key and copy it.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </SetupFormShell>
  );
}

export default PlainSetupForm;
