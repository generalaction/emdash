import { ipcMain } from 'electron';
import net from 'node:net';

function probePort(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(
      () => {
        if (done) return;
        done = true;
        try {
          socket.destroy();
        } catch {}
        resolve(false);
      },
      Math.max(1, timeoutMs)
    );
    socket.once('connect', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {}
      resolve(true);
    });
    socket.once('error', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {}
      resolve(false);
    });
  });
}

export function registerNetIpc() {
  ipcMain.handle(
    'net:probePorts',
    async (_e, host: string, ports: number[], timeoutMs?: number) => {
      const h = (host || 'localhost').trim() || 'localhost';
      const ps = Array.isArray(ports) ? ports.map((p) => Number(p)).filter((p) => p > 0) : [];
      const t = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 800;
      if (!ps.length) return { reachable: [] };
      const results = await Promise.all(ps.map((p) => probePort(h, p, t)));
      const reachable = ps.filter((_, i) => !!results[i]);
      return { reachable };
    }
  );
}
