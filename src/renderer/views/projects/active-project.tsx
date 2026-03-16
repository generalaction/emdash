import { Github, MoreHorizontal } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { useShowModal } from '@renderer/core/modal-provider';
import { useRequiredCurrentProject } from './project-view-wrapper';

export function ActiveProject() {
  const project = useRequiredCurrentProject();
  const showProjectSettingsModal = useShowModal('projectSettingsModal');

  return (
    <div className="max-w-5xl mx-auto p-8 w-full">
      <Tabs className="flex flex-col">
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
            <Button variant="outline">
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
                <DropdownMenuItem>Rename project</DropdownMenuItem>
                <DropdownMenuItem>Delete project</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <TabsContent value="tasks">Tasks</TabsContent>
        <TabsContent value="prs">Pull request list</TabsContent>
        <TabsContent value="settings">Settings</TabsContent>
      </Tabs>
    </div>
  );
}
