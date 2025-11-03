import React from 'react';

type Props = {
  showGithubRequirement: boolean;
  needsGhInstall: boolean;
  needsGhAuth: boolean;
  showAgentRequirement?: boolean;
};

const RequirementsNotice: React.FC<Props> = ({
  showGithubRequirement,
  needsGhInstall,
  needsGhAuth,
  showAgentRequirement,
}) => {
  return (
    <div className="mx-auto max-w-2xl space-y-4 text-sm text-gray-500">
      {showGithubRequirement && (
        <div>
          <p className="mb-2">
            <strong>Requirements:</strong> GitHub CLI
          </p>
          {needsGhInstall ? (
            <p className="text-xs">
              Install: <code className="rounded bg-gray-100 px-1">brew install gh</code>
            </p>
          ) : (
            needsGhAuth && (
              <p className="text-xs">
                Authenticate: <code className="rounded bg-gray-100 px-1">gh auth login</code>
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default RequirementsNotice;
