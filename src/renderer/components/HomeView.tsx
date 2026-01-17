import React from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, Github, Plus } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import emdashLogo from '../../assets/images/emdash/emdash_logo.svg';
import emdashLogoWhite from '../../assets/images/emdash/emdash_logo_white.svg';

/**
 * Home view component showing main action buttons and logo
 * Extracted from App.tsx to reduce component size
 */

export interface HomeViewProps {
  onOpenProject: () => void;
  onNewProject: () => void;
  onCloneProject: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onOpenProject,
  onNewProject,
  onCloneProject,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';
  const logoSrc = isDark ? emdashLogoWhite : emdashLogo;

  const handleOpenClick = async () => {
    const { captureTelemetry } = await import('../lib/telemetryClient');
    captureTelemetry('project_open_clicked');
    onOpenProject();
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="container mx-auto flex min-h-full max-w-3xl flex-1 flex-col justify-center px-8 py-8">
        <div className="mb-3 text-center">
          <div className="mb-3 flex items-center justify-center">
            <div className="logo-shimmer-container">
              <img
                key={effectiveTheme}
                src={logoSrc}
                alt="Emdash"
                className="logo-shimmer-image"
              />
              <span
                className="logo-shimmer-overlay"
                aria-hidden="true"
                style={{
                  WebkitMaskImage: `url(${logoSrc})`,
                  maskImage: `url(${logoSrc})`,
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
            onClick={handleOpenClick}
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
            onClick={onNewProject}
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