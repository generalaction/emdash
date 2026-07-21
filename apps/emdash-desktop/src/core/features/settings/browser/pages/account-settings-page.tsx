import { PageLayout } from '@emdash/ui/react/patterns';
import { AccountTab } from '../components/AccountTab';

export function AccountSettingsPage() {
  return (
    <div className="space-y-8">
      <PageLayout.Header sticky title="Account" description="Manage your Emdash account." />
      <AccountTab />
    </div>
  );
}
