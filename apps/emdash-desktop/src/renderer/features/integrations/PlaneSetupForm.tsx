import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

export const PLANE_CLOUD_API_BASE_URL = 'https://api.plane.so';

function PlaneSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(PLANE_CLOUD_API_BASE_URL);
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [token, setToken] = useState('');

  return (
    <SetupFormShell
      providerId="plane"
      getInput={() => ({
        apiBaseUrl: apiBaseUrl.trim(),
        workspaceSlug: workspaceSlug.trim(),
        token: token.trim(),
      })}
      canSubmit={!!(apiBaseUrl.trim() && workspaceSlug.trim() && token.trim())}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          placeholder={PLANE_CLOUD_API_BASE_URL}
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
          className="h-9 w-full"
          aria-label="Plane API base URL"
          autoFocus
        />
        <Input
          placeholder="Workspace slug"
          value={workspaceSlug}
          onChange={(e) => setWorkspaceSlug(e.target.value)}
          className="h-9 w-full"
          aria-label="Plane workspace slug"
        />
        <Input
          type="password"
          placeholder="API key"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
          aria-label="Plane API key"
        />
        <p className="text-muted-foreground text-xs">
          For Plane Cloud, use the default API base URL. For self-hosted Plane, enter your instance
          API base URL.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default PlaneSetupForm;
