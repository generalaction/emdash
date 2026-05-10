import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const ELECTRON_API_STUB = `
<script>
(function() {
  const seedProjects = [
    {
      type: 'local', id: 'p1', name: 'demo-project',
      path: '/tmp/demo', baseRef: 'main',
      archived: false, icon: null, iconColor: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ];
  const projectsById = new Map(seedProjects.map(p => [p.id, p]));
  const handlers = {
    'projects.getProjects': () => Array.from(projectsById.values()),
    'projects.getProjectBootstrapStatus': () => ({ status: 'ready' }),
    'projects.openProject': () => ({ success: true }),
    'projects.getProjectSettings': () => ({}),
    'projects.setProjectArchived': (id, archived) => {
      const p = projectsById.get(id); if (p) p.archived = archived;
    },
    'projects.updateProjectAppearance': (id, icon, iconColor) => {
      const p = projectsById.get(id); if (p) { p.icon = icon; p.iconColor = iconColor; }
    },
    'tasks.getTasks': () => [],
    'tasks.getTaskBootstrapStatus': () => ({ status: 'ready' }),
    'conversations.getConversationsForTask': () => [],
    'app.getAppVersion': () => '0.0.0-web',
    'app.getUpdateStatus': () => ({ status: 'idle' }),
    'app.getPlatform': () => 'web',
    'github.connections.getStatus': () => ({ connected: false }),
    'settings.get': () => ({}),
    'settings.getAll': () => ({}),
    'viewState.get': () => null,
    'viewState.getAll': () => ({}),
    'viewState.set': () => {},
    'viewState.del': () => {},
    'sshConnections.list': () => [],
    'skills.list': () => [],
    'skills.listInstalled': () => [],
    'mcp.list': () => [],
    'integrations.getStatus': () => ({}),
    'telemetry.getEnabled': () => false,
  };
  const subs = new Map();
  window.electronAPI = {
    invoke: (channel, ...args) => {
      const h = handlers[channel];
      if (h) {
        try { return Promise.resolve(h(...args)); }
        catch (e) { console.warn('[stub error]', channel, e); return Promise.resolve(null); }
      }
      return Promise.resolve(null);
    },
    eventSend: () => {},
    eventOn: (channel, cb) => {
      let arr = subs.get(channel) || [];
      arr.push(cb);
      subs.set(channel, arr);
      return () => {
        const a = subs.get(channel) || [];
        subs.set(channel, a.filter(x => x !== cb));
      };
    },
  };
})();
</script>
`;

const stubElectronApi: Plugin = {
  name: 'stub-electron-api',
  transformIndexHtml(html) {
    return html.replace('<head>', '<head>' + ELECTRON_API_STUB);
  },
};

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), tailwindcss(), stubElectronApi],
  resolve: {
    alias: {
      '@': resolve('src'),
      '@renderer': resolve('src/renderer'),
      '@shared': resolve('src/shared'),
      '@root': resolve('.'),
    },
  },
  server: { port: 3000, strictPort: true },
});
