import { createEventStreamHost } from '@agent/wire/live';
import { desktopHostContract } from '@core/primitives/desktop-host/api/host-contract';

export const desktopHostEvents = createEventStreamHost(desktopHostContract.events);
