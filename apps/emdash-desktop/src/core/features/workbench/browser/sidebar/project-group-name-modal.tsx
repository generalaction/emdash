import { Button, Dialog, Field, Input } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { useModalController } from '@core/manifests/browser/modal-api';
import { ConfirmButton } from '@core/primitives/keybindings/browser/confirm-button';
import { defineModal } from '@core/primitives/modals/react';

type ProjectGroupNameModalArgs =
  /** Create a group, optionally moving `projectId` into it. */
  { mode: 'create'; projectId?: string } | { mode: 'rename'; groupId: string; currentName: string };

export const ProjectGroupNameModal = observer(function ProjectGroupNameModal(
  args: ProjectGroupNameModalArgs
) {
  const { complete, dismiss } = useModalController('projectGroupNameModal');
  const currentName = args.mode === 'rename' ? args.currentName : '';
  const [name, setName] = useState(currentName);

  const trimmedName = name.trim();
  const isValid = trimmedName.length > 0 && trimmedName !== currentName;

  const handleSubmit = () => {
    if (!isValid) return;
    const sidebar = getSidebarStore();
    if (args.mode === 'create') {
      sidebar.createGroup(trimmedName, args.projectId);
    } else {
      sidebar.renameGroup(args.groupId, trimmedName);
    }
    complete();
  };

  return (
    <>
      <Dialog.Header showCloseButton={false}>
        <Dialog.Title>{args.mode === 'create' ? 'New project group' : 'Rename group'}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="pt-0">
        <Field.Group>
          <Field.Root>
            <Field.Label>Group name</Field.Label>
            <Input
              value={name}
              placeholder="e.g. Customers"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              autoFocus
            />
          </Field.Root>
        </Field.Group>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="secondary" onClick={dismiss}>
          Cancel
        </Button>
        <ConfirmButton variant="primary" onClick={handleSubmit} disabled={!isValid}>
          {args.mode === 'create' ? 'Create' : 'Rename'}
        </ConfirmButton>
      </Dialog.Footer>
    </>
  );
});

export const projectGroupNameModal = defineModal<void>()({
  id: 'projectGroupNameModal',
  component: ProjectGroupNameModal,
  size: 'xs',
});
