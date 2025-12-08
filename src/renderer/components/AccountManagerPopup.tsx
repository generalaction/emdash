import React, { useState } from 'react';
import { Plus, Settings, ExternalLink, Trash2, Star, User, Users } from 'lucide-react';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

interface GithubAccount {
  id: string;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AccountManagerPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onAddAccount: () => void;
  onSwitchAccount: (accountId: string) => Promise<unknown>;
  onRemoveAccount: (accountId: string) => Promise<unknown>;
  onSetDefaultAccount: (accountId: string) => Promise<unknown>;
  onOpenSettings: () => void;
  accounts: GithubAccount[];
  activeAccount: GithubAccount | null;
  isLoading?: boolean;
}

function AccountManagerPopup({
  isOpen,
  onClose,
  onAddAccount,
  onSwitchAccount,
  onRemoveAccount,
  onSetDefaultAccount,
  onOpenSettings,
  accounts,
  activeAccount,
  isLoading = false,
}: AccountManagerPopupProps) {
  const { toast } = useToast();
  const [accountToRemove, setAccountToRemove] = useState<string | null>(null);

  const handleSwitchAccount = async (accountId: string) => {
    if (accountId === activeAccount?.id) return;

    try {
      await onSwitchAccount(accountId);
      toast({
        title: "Account switched",
        description: `Switched to ${accounts.find(a => a.id === accountId)?.login}`,
      });
      onClose();
    } catch (error) {
      toast({
        title: "Failed to switch account",
        description: "Could not switch to the selected account. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    if (accounts.length <= 1) {
      toast({
        title: "Cannot remove account",
        description: "You must have at least one GitHub account connected.",
        variant: "destructive",
      });
      return;
    }

    setAccountToRemove(accountId);
  };

  const confirmRemoveAccount = async () => {
    if (!accountToRemove) return;

    const account = accounts.find(a => a.id === accountToRemove);
    if (!account) return;

    try {
      await onRemoveAccount(accountToRemove);
      toast({
        title: "Account removed",
        description: `${account.login} has been removed from your accounts.`,
      });

      // If we removed the active account, we need to close and let the parent handle the state update
      if (accountToRemove === activeAccount?.id) {
        onClose();
      }
    } catch (error) {
      toast({
        title: "Failed to remove account",
        description: "Could not remove the account. Please try again.",
        variant: "destructive",
      });
    } finally {
      setAccountToRemove(null);
    }
  };

  const handleSetDefaultAccount = async (accountId: string) => {
    try {
      await onSetDefaultAccount(accountId);
      toast({
        title: "Default account updated",
        description: `${accounts.find(a => a.id === accountId)?.login} is now your default account.`,
      });
    } catch (error) {
      toast({
        title: "Failed to update default",
        description: "Could not set the default account. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleViewProfile = (login: string) => {
    window.open(`https://github.com/${login}`, '_blank');
  };

  const renderAccount = (account: GithubAccount, isActive: boolean = false) => (
    <div
      key={account.id}
      className={`p-3 rounded-lg border ${
        isActive ? 'bg-muted border-primary border-2' : 'hover:bg-muted/50'
      } transition-colors`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {isActive ? 'Active Account' : account.name}
          </span>
          {isActive && (
            <div className="h-2 w-2 bg-green-500 rounded-full" />
          )}
          {account.isDefault && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3 w-3 fill-current" />
              Default
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-muted rounded-full flex items-center justify-center">
            <span className="text-xs font-medium">
              {account.login.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{account.name}</span>
            </div>
            <div className="text-xs text-muted-foreground">@{account.login}</div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!isActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSwitchAccount(account.id)}
              className="h-8 px-2"
            >
              Switch
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleViewProfile(account.login)}
            className="h-8 w-8 p-0"
            title="View Profile"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>

          {isActive && !account.isDefault && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSetDefaultAccount(account.id)}
              className="h-8 w-8 p-0"
              title="Set as Default"
            >
              <Star className="h-4 w-4" />
            </Button>
          )}

          {!isActive && accounts.length > 1 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRemoveAccount(account.id)}
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              title="Remove Account"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <AlertDialog open={isOpen} onOpenChange={onClose}>
        <AlertDialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              GitHub Accounts
            </AlertDialogTitle>
            <AlertDialogDescription>
              Manage your connected GitHub accounts and switch between them.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            {/* Active Account */}
            {activeAccount && renderAccount(activeAccount, true)}

            {/* Other Accounts */}
            {accounts.length > 1 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Other Accounts ({accounts.length - 1})
                </h4>
                <div className="space-y-2">
                  {accounts
                    .filter(account => account.id !== activeAccount?.id)
                    .map(account => renderAccount(account, false))}
                </div>
              </div>
            )}

            {/* No Accounts State */}
            {accounts.length === 0 && !isLoading && (
              <div className="text-center py-8">
                <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium mb-2">No GitHub Accounts</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Connect your GitHub account to get started with GitHub integration.
                </p>
              </div>
            )}

            {/* Loading State */}
            {isLoading && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">Loading accounts...</p>
              </div>
            )}

            {/* Actions */}
            {!isLoading && (
              <div className="flex gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={onAddAccount}
                  className="flex-1"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Account
                </Button>
                <Button
                  variant="outline"
                  onClick={onOpenSettings}
                  className="flex-1"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </Button>
              </div>
            )}
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove Account Confirmation */}
      <AlertDialog open={!!accountToRemove} onOpenChange={() => setAccountToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove GitHub Account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {accounts.find(a => a.id === accountToRemove)?.login}?
              {accounts.find(a => a.id === accountToRemove)?.isDefault && (
                <span className="block mt-2 text-orange-600">
                  ⚠️ This is your default account. You'll need to set another account as default.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setAccountToRemove(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemoveAccount}>
              Remove Account
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default AccountManagerPopup;
