import { Info } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function AsanaSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [apiKey, setApiKey] = useState('');

  return (
    <SetupFormShell
      providerId="asana"
      getInput={() => apiKey.trim()}
      canSubmit={!!apiKey.trim()}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          type="password"
          placeholder="Asana personal access token"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="h-9 w-full"
          aria-label="Asana personal access token"
          autoFocus
        />
        <div className="bg-muted/40 rounded-md border border-dashed border-border/70 p-2">
          <div className="flex items-start gap-2">
            <Info className="text-muted-foreground mt-0.5 h-4 w-4" aria-hidden="true" />
            <div className="text-muted-foreground text-xs leading-snug">
              <p className="font-medium text-foreground">How to get an Asana access token</p>
              <ol className="mt-1 list-decimal pl-4">
                <li>Open Asana, go to your profile photo → My Settings → Apps.</li>
                <li>Open “Developer apps” and create a Personal Access Token.</li>
                <li>Copy the token and paste it here.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </SetupFormShell>
  );
}

export default AsanaSetupForm;
