import { motion } from 'framer-motion';
import { FolderOpen, Github, Plus } from 'lucide-react';
import React from 'react';
import emdashLogo from '../assets/images/emdash/emdash_logo.svg';
import emdashLogoWhite from '../assets/images/emdash/emdash_logo_white.svg';

interface HomeViewProps {
  effectiveTheme: string;
  onOpenProject: () => void;
  onCreateProject: () => void;
  onCloneProject: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  effectiveTheme,
  onOpenProject,
  onCreateProject,
  onCloneProject,
}) => {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="container mx-auto flex min-h-full max-w-3xl flex-1 flex-col justify-center px-8 py-8">
        <div className="mb-3 text-center">
          <div className="mb-3 flex items-center justify-center">
            <div className="logo-shimmer-container">
              <img
                key={effectiveTheme}
                src={
                  effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                    ? emdashLogoWhite
                    : emdashLogo
                }
                alt="Emdash"
                className="logo-shimmer-image"
              />
              <span
                className="logo-shimmer-overlay"
                aria-hidden="true"
                style={{
                  WebkitMaskImage: `url(${
                    effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                      ? emdashLogoWhite
                      : emdashLogo
                  })`,
                  maskImage: `url(${
                    effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                      ? emdashLogoWhite
                      : emdashLogo
                  })`,
                  WebkitMaskRepeat: 'no-repeat',
                  maskRepeat: 'no-repeat',
                  WebkitMaskSize: 'contain',
                  maskSize: 'contain',
                  WebkitMaskPosition: 'center',
                  maskPosition: 'center',
                }}
              />
            </div>
          </div>
          <p className="whitespace-nowrap text-xs text-muted-foreground">
            Coding Agent Dashboard
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-2">
          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.1, ease: 'easeInOut' }}
            onClick={() => {
              void (async () => {
                const { captureTelemetry } = await import('../lib/telemetryClient');
                captureTelemetry('project_open_clicked');
              })();
              onOpenProject();
            }}
            className="group flex flex-col items-start justify-between rounded-lg border border-border bg-muted/20 p-4 text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <FolderOpen className="mb-5 h-5 w-5 text-foreground opacity-70" />
            <div className="w-full min-w-0 text-left">
              <h3 className="truncate text-xs font-semibold">Open project</h3>
            </div>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.1, ease: 'easeInOut' }}
            onClick={onCreateProject}
            className="group flex flex-col items-start justify-between rounded-lg border border-border bg-muted/20 p-4 text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Plus className="mb-5 h-5 w-5 text-foreground opacity-70" />
            <div className="w-full min-w-0 text-left">
              <h3 className="truncate text-xs font-semibold">Create New Project</h3>
            </div>
          </motion.button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.1, ease: 'easeInOut' }}
            onClick={onCloneProject}
            className="group flex flex-col items-start justify-between rounded-lg border border-border bg-muted/20 p-4 text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Github className="mb-5 h-5 w-5 text-foreground opacity-70" />
            <div className="w-full min-w-0 text-left">
              <h3 className="truncate text-xs font-semibold">Clone from GitHub</h3>
            </div>
          </motion.button>
        </div>
      </div>
    </div>
  );
};
