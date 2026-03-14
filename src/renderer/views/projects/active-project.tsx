import { Github, MoreHorizontal } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';

export function ActiveProject() {
  return (
    <div className="max-w-5xl mx-auto p-8 w-full">
      <Tabs className="flex flex-col">
        <div className="border-b border-border pb-4 flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="prs">Pull requests</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
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
