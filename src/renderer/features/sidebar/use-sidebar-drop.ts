import { useCallback, useRef, useState } from 'react';
import { basenameFromAnyPath } from '@shared/path-name';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { getDraggedFilePaths, hasDraggedFiles } from '@renderer/lib/drag-files';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { log } from '@renderer/utils/logger';

export function useSidebarDrop() {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const { navigate } = useNavigate();
  const { toast } = useToast();

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragCounter.current++;
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragOver(false);

      const filePaths = getDraggedFilePaths(e.dataTransfer);
      if (filePaths.length === 0) return;

      const projectManager = getProjectManagerStore();

      void Promise.allSettled(
        filePaths.map(async (filePath) => {
          try {
            const status = await rpc.projects.inspectProjectPath({
              type: 'local',
              path: filePath,
            });
            if (!status.isDirectory) {
              toast({
                title: 'Cannot add project',
                description: 'Drop a folder to add it as a project.',
                variant: 'destructive',
              });
              return null;
            }
            if (!status.isGitRepo) {
              toast({
                title: 'Cannot add project',
                description: `${basenameFromAnyPath(filePath)} is not a git repository.`,
                variant: 'destructive',
              });
              return null;
            }

            const name = basenameFromAnyPath(filePath);
            return await projectManager.createProject(
              { type: 'local' },
              {
                mode: 'pick',
                name,
                path: filePath,
                initGitRepository: false,
              }
            );
          } catch (err) {
            log.error('Failed to add dropped project:', err);
            toast({
              title: 'Cannot add project',
              description: `Failed to add ${basenameFromAnyPath(filePath)} as a project.`,
              variant: 'destructive',
            });
            return null;
          }
        })
      ).then((results) => {
        const projectIds = results.flatMap((r) =>
          r.status === 'fulfilled' && r.value != null ? [r.value] : []
        );
        const firstProjectId = projectIds[0];

        if (firstProjectId) {
          navigate('project', { projectId: firstProjectId });
        }

        if (projectIds.length > 1) {
          toast({
            title: 'Projects added',
            description: `${projectIds.length} projects added.`,
          });
        }
      });
    },
    [navigate, toast]
  );

  return { isDragOver, onDragOver, onDragEnter, onDragLeave, onDrop };
}
