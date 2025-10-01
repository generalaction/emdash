import React from 'react'

type Props = {
  showGithubRequirement: boolean
  needsGhInstall: boolean
  needsGhAuth: boolean
  showAgentRequirement: boolean
}

const RequirementsNotice: React.FC<Props> = ({
  showGithubRequirement,
  needsGhInstall,
  needsGhAuth,
  showAgentRequirement,
}) => {
  return (
    <div className="text-sm text-gray-500 max-w-2xl mx-auto space-y-4">
      {showGithubRequirement && (
        <div>
          <p className="mb-2">
            <strong>Requirements:</strong> GitHub CLI
          </p>
          {needsGhInstall ? (
            <p className="text-xs">
              Install: <code className="bg-gray-100 px-1 rounded">brew install gh</code>
            </p>
          ) : (
            needsGhAuth && (
              <p className="text-xs">
                Authenticate: <code className="bg-gray-100 px-1 rounded">gh auth login</code>
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
          <div className="text-xs space-y-2">
            <div>
              <span className="font-medium">Codex CLI</span>
              <div>
                Install: <code className="bg-gray-100 px-1 rounded">npm install -g @openai/codex</code>
              </div>
              <div>
                Authenticate: <code className="bg-gray-100 px-1 rounded">codex auth login</code>
              </div>
            </div>
            <div>
              <span className="font-medium">Claude Code CLI</span>
              <div>
                Install: <code className="bg-gray-100 px-1 rounded">npm install -g @anthropic-ai/claude-code</code>
              </div>
              <div>
                Login: <code className="bg-gray-100 px-1 rounded">claude</code> then <code className="bg-gray-100 px-1 rounded">/login</code>
              </div>
            </div>
            <div>
              <span className="font-medium">Gemini CLI</span>
              <div>
                Install: <code className="bg-gray-100 px-1 rounded">npm install -g @google/gemini-cli</code>
              </div>
              <div>
                Docs:{' '}
                <a className="underline" href="https://github.com/google-gemini/gemini-cli" target="_blank" rel="noreferrer">github.com/google-gemini/gemini-cli</a>
              </div>
            </div>
            <div>
              <span className="font-medium">Factory CLI (Droid)</span>
              <div>
                Quickstart:{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => (window as any).electronAPI.openExternal?.('https://docs.factory.ai/cli/getting-started/quickstart')}
                >
                  docs.factory.ai/cli/getting-started/quickstart
                </button>
              </div>
            </div>
            <div className="text-[11px] text-gray-500">
              Use Codex or Claude in chat, or Droid in the embedded terminal.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default RequirementsNotice
