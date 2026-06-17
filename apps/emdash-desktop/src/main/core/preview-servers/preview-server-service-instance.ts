import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { events } from '@main/lib/events';
import { previewServerEventChannel } from '@shared/core/preview-servers/events';
import { PortForwardService } from '../port-forwards/port-forward-service';
import { PreviewServerService } from './preview-server-service';

export const previewServerService = new PreviewServerService({
  portForwards: new PortForwardService(),
  emit: (event) => events.emit(previewServerEventChannel, event),
  getConnectionState: (connectionId) => sshConnectionManager.getConnectionState(connectionId),
  getSshProxy: async (connectionId) => await sshConnectionManager.connect(connectionId),
});

sshConnectionManager.on('connection-event', (event) => {
  previewServerService.handleSshConnectionEvent(event);
});
