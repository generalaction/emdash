import React from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Lock, Calendar, Download } from 'lucide-react';

interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  updated_at: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
}

interface RepositoryListProps {
  repositories: Repository[];
  onImportRepository: (repo: Repository) => void;
  onOpenRepository: (repo: Repository) => void;
}

const RepositoryList: React.FC<RepositoryListProps> = ({
  repositories,
  onImportRepository,
  onOpenRepository,
}) => {
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 30) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const getRepositoryIcon = (repo: Repository) => {
    // Simple icon based on repository name or language
    const firstLetter = repo.name.charAt(0).toUpperCase();
    return (
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
        {firstLetter}
      </div>
    );
  };

  return (
    <div className="mx-auto w-full max-w-[600px]">
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {repositories.map((repo) => (
          <Card
            key={repo.id}
            className="cursor-pointer p-4 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            onClick={() => onOpenRepository(repo)}
          >
            <div className="flex items-center justify-between">
              <div className="flex min-w-0 flex-1 items-center space-x-3">
                {getRepositoryIcon(repo)}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-medium text-gray-900 dark:text-gray-100">
                      {repo.name}
                    </h3>
                    {repo.private && <Lock className="h-4 w-4 text-gray-400" />}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="truncate">Owner: <span className="text-gray-700 dark:text-gray-300">{repo.full_name.split('/')[0]}</span></span>
                  </div>
                  {repo.description && (
                    <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400">
                      {repo.description}
                    </p>
                  )}
                </div>

                {/* Date */}
                <div className="flex items-center space-x-1 text-sm text-gray-500 dark:text-gray-400">
                  <Calendar className="h-4 w-4" />
                  <span>{formatDate(repo.updated_at)}</span>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="ml-4 border-gray-300 bg-gray-100 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600"
                onClick={(e) => {
                  e.stopPropagation();
                  onImportRepository(repo);
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Import
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {repositories.length === 0 && (
        <div className="py-8 text-center text-gray-500 dark:text-gray-400">
          <p>No repositories found</p>
        </div>
      )}
    </div>
  );
};

export default RepositoryList;
