import React, { useState } from 'react';
import { Repo, Run } from '../types';
import RunLauncher from './RunLauncher';
import RunList from './RunList';
import { FolderOpen } from 'lucide-react';

interface MainContentProps {
  selectedRepo: Repo | null;
  runs: Run[];
  selectedRun: Run | null;
  onRunSelect: (run: Run) => void;
  onCreateRun: (config: any) => void;
}

const MainContent: React.FC<MainContentProps> = ({
  selectedRepo,
  runs,
  selectedRun,
  onRunSelect,
  onCreateRun,
}) => {
  const [showRunLauncher, setShowRunLauncher] = useState(false);

  const handleCreateRun = (config: any) => {
    onCreateRun(config);
    setShowRunLauncher(false);
  };

  if (!selectedRepo) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-8">
            <h1
              className="mb-4 font-mono text-6xl font-semibold text-white"
              style={{
                letterSpacing: '0.1em',
                textShadow: '2px 2px 0px #000',
              }}
            >
              Emdash
            </h1>
            <h2 className="text-2xl text-muted-foreground">Codex</h2>
          </div>

          <div className="flex justify-center gap-6">
            <div className="rounded-lg border border-border bg-card p-6 transition-colors hover:bg-accent">
              <div className="mb-3 flex justify-center">
                <FolderOpen className="h-12 w-12 text-blue-400" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-white">Open Project</h3>
              <p className="text-sm text-muted-foreground">Select a repository to get started</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <div className="border-b border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {selectedRepo.path.split('/').pop()}
            </h2>
            <p className="text-sm text-muted-foreground">{selectedRepo.origin}</p>
          </div>
          <div className="flex gap-2">
            <button
              className="rounded bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
              onClick={() => setShowRunLauncher(true)}
            >
              Start Run
            </button>
            <button className="rounded bg-muted px-4 py-2 text-white transition-colors hover:bg-muted">
              Settings
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {runs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mb-4 text-6xl">🤖</div>
              <h3 className="mb-2 text-xl font-semibold text-white">No runs yet</h3>
              <p className="mb-4 text-muted-foreground">Start your first coding agent run</p>
              <button
                className="rounded-lg bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-700"
                onClick={() => setShowRunLauncher(true)}
              >
                Create Run
              </button>
            </div>
          </div>
        ) : (
          <RunList runs={runs} selectedRun={selectedRun} onRunSelect={onRunSelect} />
        )}
      </div>

      {showRunLauncher && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <RunLauncher
            repo={selectedRepo}
            onCreateRun={handleCreateRun}
            onCancel={() => setShowRunLauncher(false)}
          />
        </div>
      )}
    </div>
  );
};

export default MainContent;
