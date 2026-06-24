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
        {isEditing ? (
          <p className="text-xs text-foreground-muted">
            A Notion access token is already saved. Enter a new token only if you want to replace
            it.
          </p>
        ) : null}
        <Input
          type="password"
          placeholder={isEditing ? 'New access token (optional)' : 'Access token'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
          autoFocus
        />
        <Input
          placeholder="Page, database, or data source URLs (optional)"
          value={databaseUrls}
          onChange={(e) => setDatabaseUrls(e.target.value)}
          className="h-9 w-full"
        />
        <p className="text-muted-foreground text-xs">
          Create a connection at <span className="font-medium">notion.com/my-integrations</span>,
          copy the access token, then share the target pages or databases with that connection. Add
          URLs to choose exactly which data sources Emdash searches; otherwise it searches all
          shared pages.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default NotionSetupForm;
