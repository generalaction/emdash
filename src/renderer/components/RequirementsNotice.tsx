import React from 'react';

type Props = {
  showGithubRequirement: boolean;
  needsGhInstall: boolean;
  needsGhAuth: boolean;
  showAgentRequirement: boolean;
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

      {showAgentRequirement && (
        <div className="space-y-2">
          <p className="mb-1">
            <strong>Requirements:</strong> Install at least one of the following CLIs
          </p>
          <div className="space-y-2 text-xs">
            <div>
              <span className="font-medium">Codex CLI</span>
              <div>
                Install:{' '}
                <code className="rounded bg-gray-100 px-1">npm install -g @openai/codex</code>
              </div>
              <div>
                Authenticate: <code className="rounded bg-gray-100 px-1">codex auth login</code>
              </div>
            </div>
            <div>
              <span className="font-medium">Goose CLI</span>
              <div>
                Quickstart:{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    (window as any).electronAPI.openExternal?.(
                      'https://block.github.io/goose/docs/quickstart/'
                    )
                  }
                >
                  block.github.io/goose/docs/quickstart/
                </button>
              </div>
            </div>
            <div>
              <span className="font-medium">Claude Code CLI</span>
              <div>
                Install:{' '}
                <code className="rounded bg-gray-100 px-1">
                  npm install -g @anthropic-ai/claude-code
                </code>
              </div>
              <div>
                Login: <code className="rounded bg-gray-100 px-1">claude</code> then{' '}
                <code className="rounded bg-gray-100 px-1">/login</code>
              </div>
            </div>
            <div>
              <span className="font-medium">Factory CLI (Droid)</span>
              <div>
                Quickstart:{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    (window as any).electronAPI.openExternal?.(
                      'https://docs.factory.ai/cli/getting-started/quickstart'
                    )
                  }
                >
                  docs.factory.ai/cli/getting-started/quickstart
                </button>
              </div>
            </div>
            <div>
              <span className="font-medium">Gemini CLI</span>
              <div>
                Project:{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    (window as any).electronAPI.openExternal?.(
                      'https://github.com/google-gemini/gemini-cli'
                    )
                  }
                >
                  github.com/google-gemini/gemini-cli
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RequirementsNotice;
