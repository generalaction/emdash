import { ipcMain } from 'electron';
import { mobileServer } from '../services/MobileServer';

export function registerMobileIpc(): void {
  ipcMain.handle('mobile:getInfo', () => ({
    enabled: mobileServer.isEnabled(),
    port: mobileServer.getPort(),
    pin: mobileServer.getPin(),
    urls: mobileServer.getLanUrls(),
  }));
}
