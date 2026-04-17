import http from 'http';
import { URL } from 'url';
import { BrowserWindow } from 'electron';
import { log } from '../lib/logger';
import { databaseService } from './DatabaseService';

const PORT = 3847;
const API_BASE = '/api/v1';

interface ApiResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

class LocalApiService {
  private server: http.Server | null = null;

  async start(): Promise<void> {
    if (this.server) return;

    this.server = http.createServer(async (req, res) => {
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      try {
        const parsedUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
        const pathname = parsedUrl.pathname;

        res.setHeader('Content-Type', 'application/json');
        Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

        let response: ApiResponse = { success: false, error: 'Not found' };
        let statusCode = 404;

        if (pathname.startsWith(`${API_BASE}/projects`)) {
          response = await this.handleProjects(parsedUrl, req);
          statusCode = response.success ? 200 : 400;
        } else if (pathname.startsWith(`${API_BASE}/tasks`)) {
          response = await this.handleTasks(parsedUrl, req);
          statusCode = response.success ? 200 : 400;
        } else if (pathname.startsWith(`${API_BASE}/ssh/connections`)) {
          response = await this.handleSshConnections();
          statusCode = 200;
        } else if (pathname.startsWith(`${API_BASE}/health`)) {
          response = { success: true, data: { status: 'ok' } };
          statusCode = 200;
        }

        res.writeHead(statusCode);
        res.end(JSON.stringify(response));
      } catch (error) {
        log.warn('LocalApiService: internal error', { error: String(error) });
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
      }
    });

    return new Promise<void>((resolve, reject) => {
      this.server!.listen(PORT, '127.0.0.1', () => {
        log.info('LocalApiService: started', { port: PORT });
        resolve();
      });
      this.server!.on('error', (err) => {
        log.error('LocalApiService: failed to start', { error: String(err) });
        reject(err);
      });
    });
  }

  private async handleProjects(parsedUrl: URL, req: http.IncomingMessage): Promise<ApiResponse> {
    const pathname = parsedUrl.pathname;

    if (parsedUrl.searchParams.has('recent')) {
      const projects = await databaseService.getProjects();
      const sorted = projects
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 10);
      return { success: true, data: sorted };
    }

    if (req.method === 'GET' && pathname === `${API_BASE}/projects`) {
      const projects = await databaseService.getProjects();
      return { success: true, data: projects };
    }

    if (req.method === 'GET' && pathname.startsWith(`${API_BASE}/projects/`)) {
      const id = pathname.split('/').pop();
      if (!id) return { success: false, error: 'Missing project ID' };
      const projects = await databaseService.getProjects();
      const project = projects.find((p) => p.id === id);
      if (!project) return { success: false, error: 'Project not found' };
      return { success: true, data: project };
    }

    return { success: false, error: 'Not found' };
  }

  private async handleTasks(parsedUrl: URL, req: http.IncomingMessage): Promise<ApiResponse> {
    const projectId = parsedUrl.searchParams.get('projectId') || undefined;

    if (req.method === 'GET' && parsedUrl.pathname === `${API_BASE}/tasks`) {
      const tasks = await databaseService.getTasks(projectId);
      return { success: true, data: tasks };
    }

    if (req.method === 'POST' && parsedUrl.pathname === `${API_BASE}/tasks`) {
      const body = await this.readBody(req);
      const projectId = String(body.projectId || '');
      const title = String(body.title || '');
      if (!projectId || !title) {
        return { success: false, error: 'Missing projectId or title' };
      }
      const projects = await databaseService.getProjects();
      const project = projects.find((p) => p.id === projectId);
      if (!project) {
        return { success: false, error: 'Project not found' };
      }
      const taskId = `task-${Date.now()}`;
      const branchName = `task/${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
      await databaseService.saveTask({
        id: taskId,
        projectId,
        name: title,
        branch: branchName,
        path: project.path,
        status: 'idle',
      });
      const task = await databaseService.getTaskById(taskId);
      return { success: true, data: task };
    }

    return { success: false, error: 'Not found' };
  }

  private async handleSshConnections(): Promise<ApiResponse> {
    const connections = await databaseService.getSshConnections();
    return { success: true, data: connections };
  }

  private readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
        if (body.length > 1_000_000) {
          reject(new Error('Payload too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

export const localApiService = new LocalApiService();
