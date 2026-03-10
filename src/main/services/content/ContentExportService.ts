import { clipboard, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getMainWindow } from '../../app/window';
import { log } from '../../lib/logger';
import { contentOutputService, type ContentOutput } from './ContentOutputService';

export interface ExportOptions {
  includeMetadata?: boolean;
  filenameFormat?: 'simple' | 'detailed';
}

/**
 * Service for exporting content outputs to various formats.
 * Currently supports Markdown export to clipboard, file, and folder.
 */
export class ContentExportService {
  /**
   * Format output content with optional metadata header.
   */
  private formatOutputContent(output: ContentOutput, options: ExportOptions = {}): string {
    if (!options.includeMetadata) {
      return output.content;
    }

    const metadataLines = [
      '---',
      `agent: ${output.agentId}`,
      `version: ${output.version}`,
      `created: ${new Date(output.createdAt).toISOString()}`,
      output.selected ? 'selected: true' : null,
      '---',
      '',
    ].filter(Boolean);

    return metadataLines.join('\n') + output.content;
  }

  /**
   * Generate filename for an output.
   */
  private generateFilename(output: ContentOutput, options: ExportOptions = {}): string {
    const sanitizedAgent = output.agentId.replace(/[^a-zA-Z0-9-_]/g, '_');

    if (options.filenameFormat === 'detailed') {
      const date = new Date(output.createdAt).toISOString().split('T')[0];
      return `${sanitizedAgent}_v${output.version}_${date}.md`;
    }

    return `${sanitizedAgent}_v${output.version}.md`;
  }

  /**
   * Copy output content to clipboard.
   */
  async copyToClipboard(
    outputId: string,
    options: ExportOptions = {}
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const output = await contentOutputService.getById(outputId);
      if (!output) {
        return { success: false, error: 'Output not found' };
      }

      const content = this.formatOutputContent(output, options);
      clipboard.writeText(content);

      log.info(`Copied content output ${outputId} to clipboard`);
      return { success: true };
    } catch (error) {
      log.error('Failed to copy to clipboard:', error);
      return { success: false, error: 'Failed to copy to clipboard' };
    }
  }

  /**
   * Export output to a single .md file with save dialog.
   */
  async exportToFile(
    outputId: string,
    options: ExportOptions = {}
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const output = await contentOutputService.getById(outputId);
      if (!output) {
        return { success: false, error: 'Output not found' };
      }

      const defaultFilename = this.generateFilename(output, options);

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        return { success: false, error: 'No main window available' };
      }

      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Content',
        defaultPath: defaultFilename,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, error: 'Export cancelled' };
      }

      const content = this.formatOutputContent(output, options);
      await fs.writeFile(result.filePath, content, 'utf-8');

      log.info(`Exported content output ${outputId} to ${result.filePath}`);
      return { success: true, filePath: result.filePath };
    } catch (error) {
      log.error('Failed to export to file:', error);
      return { success: false, error: 'Failed to export to file' };
    }
  }

  /**
   * Export all outputs for a task to a folder.
   */
  async exportToFolder(
    taskId: string,
    options: ExportOptions = {}
  ): Promise<{ success: boolean; folderPath?: string; fileCount?: number; error?: string }> {
    try {
      const outputs = await contentOutputService.getByTaskId(taskId);
      if (outputs.length === 0) {
        return { success: false, error: 'No outputs found for task' };
      }

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        return { success: false, error: 'No main window available' };
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Export Folder',
        properties: ['openDirectory', 'createDirectory'],
        message: 'Choose a folder to export content outputs',
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'Export cancelled' };
      }

      const folderPath = result.filePaths[0];
      let fileCount = 0;

      // Group outputs by agent for organized export
      const outputsByAgent = new Map<string, ContentOutput[]>();
      for (const output of outputs) {
        const existing = outputsByAgent.get(output.agentId) || [];
        existing.push(output);
        outputsByAgent.set(output.agentId, existing);
      }

      // Export each output
      for (const output of outputs) {
        const filename = this.generateFilename(output, { ...options, filenameFormat: 'detailed' });
        const filePath = path.join(folderPath, filename);
        const content = this.formatOutputContent(output, options);

        await fs.writeFile(filePath, content, 'utf-8');
        fileCount++;
      }

      // Create an index file if multiple outputs
      if (outputs.length > 1) {
        const indexContent = this.generateIndexFile(outputs, taskId);
        await fs.writeFile(path.join(folderPath, '_index.md'), indexContent, 'utf-8');
      }

      log.info(`Exported ${fileCount} content outputs for task ${taskId} to ${folderPath}`);
      return { success: true, folderPath, fileCount };
    } catch (error) {
      log.error('Failed to export to folder:', error);
      return { success: false, error: 'Failed to export to folder' };
    }
  }

  /**
   * Export selected output for a task to file.
   */
  async exportSelectedToFile(
    taskId: string,
    options: ExportOptions = {}
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const output = await contentOutputService.getSelectedForTask(taskId);
      if (!output) {
        return { success: false, error: 'No selected output for task' };
      }

      return this.exportToFile(output.id, options);
    } catch (error) {
      log.error('Failed to export selected output:', error);
      return { success: false, error: 'Failed to export selected output' };
    }
  }

  /**
   * Generate an index file listing all exported outputs.
   */
  private generateIndexFile(outputs: ContentOutput[], taskId: string): string {
    const lines = [
      '# Content Outputs Index',
      '',
      `Task ID: ${taskId}`,
      `Exported: ${new Date().toISOString()}`,
      `Total outputs: ${outputs.length}`,
      '',
      '## Outputs',
      '',
    ];

    // Group by agent
    const outputsByAgent = new Map<string, ContentOutput[]>();
    for (const output of outputs) {
      const existing = outputsByAgent.get(output.agentId) || [];
      existing.push(output);
      outputsByAgent.set(output.agentId, existing);
    }

    for (const [agentId, agentOutputs] of outputsByAgent) {
      lines.push(`### ${agentId}`);
      lines.push('');

      // Sort by version descending
      const sorted = [...agentOutputs].sort((a, b) => b.version - a.version);

      for (const output of sorted) {
        const date = new Date(output.createdAt).toISOString().split('T')[0];
        const filename = this.generateFilename(output, { filenameFormat: 'detailed' });
        const selected = output.selected ? ' ⭐ (selected)' : '';
        lines.push(`- [v${output.version}](${filename}) - ${date}${selected}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

export const contentExportService = new ContentExportService();
