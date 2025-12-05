import React from 'react';
import { Input } from '../ui/input';
import { Info } from 'lucide-react';
import linearLogo from '../../../assets/images/linear-icon.png';

interface Props {
  apiKey: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  canSubmit: boolean;
  error?: string | null;
}

const LinearSetupForm: React.FC<Props> = ({
  apiKey,
  onChange,
  onSubmit,
  onClose,
  canSubmit,
  error,
}) => {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium">
          <img src={linearLogo} alt="Linear" className="h-3.5 w-3.5" />
          Linear setup
        </span>
        <span className="text-xs text-muted-foreground">
          Connect to Linear by entering an API key.
        </span>
      </div>
      <div className="mt-2 grid gap-2">
        <Input
          type="password"
          placeholder="Linear API key"
          value={apiKey}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          className="h-8 w-full"
          aria-label="Linear API key"
        />
      </div>
      <div className="mt-2 rounded-md border border-dashed border-border/70 bg-muted/40 p-2">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="text-xs leading-snug text-muted-foreground">
            <p className="font-medium text-foreground">How to get a Linear API key</p>
            <ol className="mt-1 list-decimal pl-4">
              <li>Open Linear, go to Settings → API Tokens.</li>
              <li>Create a new token and copy the key.</li>
            </ol>
          </div>
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium"
          onClick={onClose}
        >
          Close
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium disabled:opacity-60"
          onClick={() => void onSubmit()}
          disabled={!canSubmit}
        >
          Connect
        </button>
      </div>
    </div>
  );
};

export default LinearSetupForm;

