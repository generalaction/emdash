import { Info } from 'lucide-react';
import React from 'react';
import { Input } from '../../components/ui/input';

interface Props {
  apiKey: string;
  onChange: (value: string) => void;
  error?: string | null;
}

const LinearSetupForm: React.FC<Props> = ({ apiKey, onChange, error }) => {
  return (
    <div className="grid gap-2">
      <Input
        type="password"
        placeholder="Linear API key"
        value={apiKey}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="h-9 w-full"
        aria-label="Linear API key"
        autoFocus
      />
      <div className="rounded-md border border-dashed border-border/70 bg-muted/40 p-2">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="text-xs leading-snug text-muted-foreground">
            <p className="font-medium text-foreground">How to get a Linear API key</p>
            <ol className="mt-1 list-decimal pl-4">
              <li>Open Linear, go to Settings → Security & access → Personal API keys.</li>
              <li>Create a new token and copy the key.</li>
            </ol>
          </div>
        </div>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default LinearSetupForm;
