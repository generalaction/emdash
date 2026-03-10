import { Folder, Github, Plus } from 'lucide-react';
import { SshConnectionSelector } from '../ssh/ssh-connection-selector';
import { DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ButtonCard, ButtonCardGroup } from './button-card';

export function AddProjectModal() {
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add Project</DialogTitle>
      </DialogHeader>
      <Tabs className="flex flex-col space-y-4" defaultValue="local">
        <TabsList>
          <TabsTrigger value="local">Local</TabsTrigger>
          <TabsTrigger value="ssh">SSH</TabsTrigger>
        </TabsList>
        <TabsContent value="local" className="flex flex-col gap-4">
          <AddLocalProjectContent />
        </TabsContent>
        <TabsContent value="ssh">
          <AddSshProjectContent />
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

function AddLocalProjectContent() {
  return (
    <>
      <Label>Add a local project</Label>
      <ButtonCardGroup className="grid grid-cols-3">
        <ButtonCard>
          <Folder className="size-6" />
          Pick existing
        </ButtonCard>
        <ButtonCard>
          <Plus className="size-6" />
          New
        </ButtonCard>
        <ButtonCard>
          <Github className="size-6" />
          Clone
        </ButtonCard>
      </ButtonCardGroup>
    </>
  );
}

function AddSshProjectContent() {
  return (
    <>
      <Label>Select a SSH Connection</Label>
      <SshConnectionSelector onValueChange={() => {}} onAddConnection={() => {}} />
      <Tabs defaultValue="pick" className="mt-4 flex flex-col">
        <TabsList className="w-full">
          <TabsTrigger value="pick">
            <ButtonCard>
              <Folder className="size-6" />
              Pick existing
            </ButtonCard>
          </TabsTrigger>
          <TabsTrigger value="clone">
            <ButtonCard>
              <Github className="size-6" />
              Clone
            </ButtonCard>
          </TabsTrigger>
          <TabsTrigger value="new">
            <ButtonCard>
              <Plus className="size-6" />
              New
            </ButtonCard>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pick">Pick content</TabsContent>
        <TabsContent value="clone">clone content</TabsContent>
        <TabsContent value="new">new content</TabsContent>
      </Tabs>
    </>
  );
}
