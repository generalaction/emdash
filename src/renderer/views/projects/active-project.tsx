import { Github, MoreHorizontal } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { gitRemoteToUrl } from '@shared/git-remote-url';
import { PullRequestList } from '@renderer/components/projects/pr-list';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { projectManagerStore } from '@renderer/core/stores/project-manager';
import { getProjectStore, mountedProjectData } from '@renderer/core/stores/project-selectors';
import { useParams } from '@renderer/core/view/navigation-provider';
import { TaskList } from './task-list';

export const ActiveProject = observer(function ActiveProject() {
  const {
    params: { projectId },
  } = useParams('project');
  const project = mountedProjectData(getProjectStore(projectId));
  const showProjectSettingsModal = useShowModal('projectSettingsModal');

  if (!project) return null;

  const githubUrl = project.gitRemote ? gitRemoteToUrl(project.gitRemote) : undefined;

  return (
    <div className="max-w-5xl mx-auto p-8 w-full h-full flex flex-col overflow-hidden">
      <Tabs className="flex flex-col min-h-0 flex-1">
        <div className="border-b border-border pb-4 flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="prs">Pull requests</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => showProjectSettingsModal({ projectId: project.id })}
            >
              Project settings
            </Button>
            <Button
              variant="outline"
              disabled={!githubUrl}
              onClick={() => githubUrl && rpc.app.openExternal(githubUrl)}
            >
              <Github className="size-4" />
              View on Github
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon">
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent>
                <DropdownMenuItem
                  onClick={() => void projectManagerStore.deleteProject(project.id)}
                >
                  Delete project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <TabsContent value="tasks">
          <TaskList />
        </TabsContent>
        <TabsContent value="prs" className="flex flex-col min-h-0 flex-1">
          <PullRequestList />
        </TabsContent>
      </Tabs>
    </div>
  );
});
