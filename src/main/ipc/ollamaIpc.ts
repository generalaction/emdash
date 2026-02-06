import { ipcMain } from 'electron';
import { ollamaService } from '../services/OllamaService';
import type { TaskNameContext } from '../services/OllamaService';

export function registerOllamaIpc() {
  ipcMain.handle('ollama:generateTaskName', async (_event, context: TaskNameContext) => {
    const name = await ollamaService.generateTaskName(context);
    return { success: true, name };
  });
}
