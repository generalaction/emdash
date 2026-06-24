import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function NotionSetupForm(props: SetupFormProps) {
  const { data: configuration } = useQuery({
    queryKey: ['notion:configuration'],
    queryFn: () => rpc.notion.getConfiguration(),
    staleTime: 0,
  });

  return (
    <NotionSetupFormFields
      key={configuration?.databaseUrls ?? 'loading'}
      {...props}
      hasCredentials={configuration?.hasCredentials ?? false}
      initialDatabaseUrls={configuration?.databaseUrls ?? ''}
    />
  );
}

function NotionSetupFormFields({
  onSuccess,
  onClose,
  hasCredentials,
  initialDatabaseUrls,
}: SetupFormProps & { hasCredentials: boolean; initialDatabaseUrls: string }) {
  const [token, setToken] = useState('');
  const [databaseUrls, setDatabaseUrls] = useState(initialDatabaseUrls);
  const trimmedToken = token.trim();
  const isEditing = hasCredentials;

  return (
    <SetupFormShell
      providerId="notion"
      getInput={() => ({
        token: trimmedToken,
        databaseUrls: databaseUrls.trim(),
      })}
      canSubmit={isEditing || !!trimmedToken}
      submitLabel={isEditing ? 'Save changes' : 'Connect'}
      successTitle={isEditing ? 'Integration updated' : 'Integration connected'}
      successDescription={
        isEditing ? 'Notion settings updated successfully.' : 'Integration set up successfully.'
      }
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          type="password"
          placeholder={isEditing ? 'New access token (optional)' : 'Access token'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
          autoFocus
        />
        <Input
          placeholder="Page or database URLs (optional)"
          value={databaseUrls}
          onChange={(e) => setDatabaseUrls(e.target.value)}
          className="h-9 w-full"
        />
        <p className="text-muted-foreground text-xs">
          Share pages or databases with your Notion connection. Leave URLs empty to search
          everything shared.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default NotionSetupForm;
