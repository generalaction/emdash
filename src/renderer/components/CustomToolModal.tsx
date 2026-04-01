import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import type { CustomOpenInApp } from '@shared/openInApps';

interface CustomToolModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (tool: CustomOpenInApp) => void;
  onDelete?: () => void;
  initial?: CustomOpenInApp;
}

export default function CustomToolModal({
  open,
  onOpenChange,
  onSave,
  onDelete,
  initial,
}: CustomToolModalProps) {
  const [label, setLabel] = useState('');
  const [openCommand, setOpenCommand] = useState('');
  const [checkCommand, setCheckCommand] = useState('');
  const [iconPath, setIconPath] = useState('');

  const isEdit = Boolean(initial);

  useEffect(() => {
    if (open && initial) {
      setLabel(initial.label);
      setOpenCommand(initial.openCommand);
      setCheckCommand(initial.checkCommand ?? '');
      setIconPath(initial.iconPath ?? '');
    }
  }, [open, initial]);

  const id = isEdit
    ? initial!.id
    : label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

  const checkCommandError =
    checkCommand.trim() && !/^[a-zA-Z0-9_\-]+$/.test(checkCommand.trim())
      ? 'Must be a plain binary name (no spaces, flags, or paths)'
      : '';

  const isValid =
    label.trim() !== '' && openCommand.trim() !== '' && id !== '' && !checkCommandError;

  const handleSave = () => {
    if (!isValid) return;
    onSave({
      id,
      label: label.trim(),
      openCommand: openCommand.trim(),
      ...(checkCommand.trim() ? { checkCommand: checkCommand.trim() } : {}),
      ...(iconPath.trim() ? { iconPath: iconPath.trim() } : {}),
    });
    reset();
    onOpenChange(false);
  };

  const reset = () => {
    setLabel('');
    setOpenCommand('');
    setCheckCommand('');
    setIconPath('');
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Custom Tool' : 'Add Custom Tool'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the configuration for this custom tool.'
              : 'Define a custom tool that will appear in the Open In dropdown.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="custom-tool-label">Name</Label>
            <Input
              id="custom-tool-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Foot Terminal"
            />
            {!isEdit && id && (
              <p className="text-xs text-muted-foreground">
                ID: <code className="rounded bg-muted px-1">{id}</code>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-tool-command">Open Command</Label>
            <Input
              id="custom-tool-command"
              value={openCommand}
              onChange={(e) => setOpenCommand(e.target.value)}
              placeholder="e.g. foot --working-directory={{path}}"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Use <code className="rounded bg-muted px-1">{'{{path}}'}</code> as a placeholder for
              the directory.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-tool-check">
              Check Command <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="custom-tool-check"
              value={checkCommand}
              onChange={(e) => setCheckCommand(e.target.value)}
              placeholder="e.g. foot"
              className={`font-mono text-sm ${checkCommandError ? 'border-destructive' : ''}`}
            />
            {checkCommandError ? (
              <p className="text-xs text-destructive">{checkCommandError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Binary name used to detect if the tool is installed (e.g.{' '}
                <code className="rounded bg-muted px-1">foot</code>, not a full command). If empty,
                the tool is always shown.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-tool-icon">
              Icon Path <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="custom-tool-icon"
              value={iconPath}
              onChange={(e) => setIconPath(e.target.value)}
              placeholder="e.g. /usr/share/icons/tool.png"
              className="font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <div>
            {isEdit && onDelete && (
              <Button
                variant="destructive"
                onClick={() => {
                  onDelete();
                  reset();
                  onOpenChange(false);
                }}
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isValid}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
