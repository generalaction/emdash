import { EmdashAccountSection } from './EmdashAccountSection';
import { GitHubAccountsSection } from './GitHubAccountsSection';

export function AccountTab() {
  return (
    <div className="space-y-4">
      <EmdashAccountSection />
      <GitHubAccountsSection />
    </div>
  );
}
