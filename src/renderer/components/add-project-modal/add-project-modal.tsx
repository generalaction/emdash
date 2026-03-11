import { createContext, useState } from 'react';
import { useShowModal, type BaseModalProps } from '@renderer/contexts/ModalProvider';
import { SshConnectionSelector } from '../ssh/ssh-connection-selector';
import { Button } from '../ui/button';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Field, FieldLabel } from '../ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { ClonePanel, CreateNewPanel, PickExistingPanel } from './content';
import { ModeTabs } from './mode-tabs';

export type Strategy = 'local' | 'ssh';

export type Mode = 'pick' | 'new' | 'clone';

interface BaseModeData {
  name: string;
  path: string;
}

interface NewModeData extends BaseModeData {
  repositoryName: string;
  repositoryOwner: string;
  repositoryVisibility: 'public' | 'private';
}

interface CloneModeData extends BaseModeData {
  repositoryUrl: string;
}

type ModeData = BaseModeData | NewModeData | CloneModeData;

interface AddProjectContextValue {
  strategy: Strategy;
  setStrategy: (strategy: Strategy) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
  modeData: ModeData;
  setModeData: (modeData: ModeData) => void;
  connectionId?: string;
  setConnectionId: (connectionId: string | undefined) => void;
  handleSubmit: () => void;
}

export interface AddProjectModalProps extends BaseModalProps<void> {
  strategy: Strategy;
  mode: Mode;
  modeData: ModeData;
  connectionId?: string;
}

const AddProjectContext = createContext<AddProjectContextValue | null>(null);

export function AddProjectModal({
  strategy: strategyProp,
  mode: modeProp,
  modeData: modeDataProp,
  connectionId: connectionIdProp,
}: AddProjectModalProps) {
  const [strategy, setStrategy] = useState<Strategy>(strategyProp ?? 'local');
  const [mode, setMode] = useState<Mode>(modeProp ?? 'pick');
  const [modeData, setModeData] = useState<ModeData>(modeDataProp ?? { name: '', path: '' });
  const [connectionId, setConnectionId] = useState<string | undefined>(connectionIdProp);

  const showSshConnModal = useShowModal('addSshConnModal');
  const showAddProjectModal = useShowModal('addProjectModal');

  const handleAddConnection = () => {
    showSshConnModal({
      onSuccess: ({ connectionId: newId }) =>
        showAddProjectModal({
          strategy: 'ssh',
          mode,
          modeData: { name: modeData.name, path: modeData.path },
          connectionId: newId,
        }),
      onClose: () =>
        showAddProjectModal({
          strategy: 'ssh',
          mode,
          modeData: { name: modeData.name, path: modeData.path },
        }),
    });
  };

  const handlePathChange = (path: string) => {
    setModeData({ ...modeData, path });
  };

  const handleNameChange = (name: string) => {
    setModeData({ ...modeData, name });
  };

  const handleSubmit = () => {};

  return (
    <AddProjectContext.Provider
      value={{
        strategy,
        setStrategy,
        mode,
        setMode,
        modeData,
        setModeData,
        handleSubmit,
        connectionId,
        setConnectionId,
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
        </DialogHeader>

        <Tabs
          value={strategy}
          onValueChange={(v) => setStrategy(v as Strategy)}
          className="flex flex-col space-y-4"
        >
          <TabsList>
            <TabsTrigger value="local">Local</TabsTrigger>
            <TabsTrigger value="ssh">SSH</TabsTrigger>
          </TabsList>
          <TabsContent value="local" className="flex flex-col gap-4">
            <ModeTabs mode={mode} onModeChange={setMode}>
              <PickExistingPanel strategy={'local'} />
              <CreateNewPanel strategy={'local'} />
              <ClonePanel strategy={'local'} />
            </ModeTabs>
          </TabsContent>
          <TabsContent value="ssh" className="flex flex-col gap-4">
            <Field>
              <FieldLabel>SSH Connection</FieldLabel>
              <SshConnectionSelector
                connectionId={connectionId}
                onConnectionIdChange={setConnectionId}
                onAddConnection={handleAddConnection}
              />
            </Field>
            <ModeTabs mode={mode} onModeChange={setMode}>
              <PickExistingPanel strategy={'ssh'} connectionId={connectionId} />
              <CreateNewPanel strategy={'ssh'} connectionId={connectionId} />
              <ClonePanel strategy={'ssh'} connectionId={connectionId} />
            </ModeTabs>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button type="button" onClick={handleSubmit}>
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </AddProjectContext.Provider>
  );
}
