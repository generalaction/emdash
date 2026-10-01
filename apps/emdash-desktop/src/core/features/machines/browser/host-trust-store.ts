import { createScope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire/state';
import { openModal } from '@core/manifests/browser/modal-api';
import { getSshClient } from '@core/services/ssh/api/client';
import { sshContract } from '@core/services/ssh/api/contract';
import { HostTrustPresenter } from './host-trust-presenter';

/** App-scoped so connection tests, startup connections and Retry share the same modal flow. */
export class HostTrustStore {
  private readonly scope = createScope({ label: 'ssh-host-trust' });
  private presenter?: HostTrustPresenter;
  private disposed = false;

  async start(): Promise<void> {
    const client = await getSshClient();
    if (this.disposed) return;
    const presenter = new HostTrustPresenter(
      async (prompt, signal) => {
        const result = await openModal('sshHostTrustModal', { prompt, signal });
        return result.success && result.data;
      },
      (id, accepted) => client.respondToHostTrust({ id, accepted })
    );
    this.presenter = presenter;
    const model = remote(sshContract.hostTrust, client.hostTrust, { scope: this.scope })(undefined);
    observe(
      model.states.pending,
      (snapshot) => {
        presenter.update(snapshot.status === 'live' ? (snapshot.value ?? []) : []);
      },
      { scope: this.scope }
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.presenter?.dispose();
    await this.scope.dispose();
  }
}
