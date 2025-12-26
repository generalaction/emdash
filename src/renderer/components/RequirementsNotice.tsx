import React from 'react';

type Props = {
  showGithubRequirement: boolean;
  needsGhInstall: boolean;
  needsGhAuth: boolean;
};

const RequirementsNotice: React.FC<Props> = ({
  showGithubRequirement,
  needsGhInstall: _needsGhInstall,
  needsGhAuth,
}) => {
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm text-muted-foreground">
      {showGithubRequirement && (
        <div>
          <p className="mb-2">
            <strong>Requirements:</strong> GitHub account
          </p>
          {needsGhAuth && (
            <p className="text-xs">Click "Sign in with GitHub" to connect your account</p>
          )}
        </div>
      )}
    </div>
  );
};

export default RequirementsNotice;
