import { useState } from 'react';
import { Button } from '../ui/button';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { AddLocalProjectContent, AddSshProjectContent } from './content';

export type Mode = 'pick' | 'new' | 'clone';

export type Strategy = 'local' | 'ssh';

type SshStrategyData = {
  connectionId?: string;
  name?: string;
};

interface AddProjectModalProps {
  type: Strategy;
  mode?: Mode;
  data?: SshStrategyData;
}

export function AddProjectModal({ type, mode, data }: AddProjectModalProps) {
  const [tab, setTab] = useState<Strategy>(type);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add Project</DialogTitle>
      </DialogHeader>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex flex-col space-y-4"
        defaultValue="local"
      >
        <TabsList>
          <TabsTrigger value="local">Local</TabsTrigger>
          <TabsTrigger value="ssh">SSH</TabsTrigger>
        </TabsList>
        <TabsContent value="local" className="flex flex-col gap-4">
          <AddLocalProjectContent mode={mode} />
        </TabsContent>
        <TabsContent value="ssh" className="flex flex-col gap-4">
          <AddSshProjectContent mode={mode} connectionId={data?.connectionId} name={data?.name} />
        </TabsContent>
      </Tabs>
      <DialogFooter>
        <Button type="button" variant="default">
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
