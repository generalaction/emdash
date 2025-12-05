import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

export class GitHubCLIInstaller {
  /**
   * Check if gh CLI is installed
   */
  async isInstalled(): Promise<boolean> {
    try {
      await execAsync('gh --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Attempt to install gh CLI automatically
   */
  async install(): Promise<{ success: boolean; error?: string }> {
    const platform = os.platform();

    try {
      switch (platform) {
        case 'darwin': // macOS
          return await this.installMacOS();
        case 'linux':
          return await this.installLinux();
        case 'win32':
          return await this.installWindows();
        default:
          return { success: false, error: `Unsupported platform: ${platform}` };
      }
    } catch (error) {
      console.error('Failed to install gh CLI:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Installation failed',
      };
    }
  }

  private async installMacOS(): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if Homebrew is installed
      await execAsync('which brew');

      // Install gh using Homebrew
      await execAsync('brew install gh');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: 'Homebrew not found. Please install from https://brew.sh/ first.',
      };
    }
  }

  private async installLinux(): Promise<{ success: boolean; error?: string }> {
    try {
      // Try apt (Debian/Ubuntu)
      await execAsync('sudo apt update && sudo apt install -y gh');
      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Could not install gh CLI. Please install manually: https://cli.github.com/',
      };
    }
  }

  private async installWindows(): Promise<{ success: boolean; error?: string }> {
    try {
      // Try winget
      await execAsync('winget install GitHub.cli');
      return { success: true };
    } catch {
      return {
        success: false,
        error: 'Could not install gh CLI. Please install manually: https://cli.github.com/',
      };
    }
  }
}

export const githubCLIInstaller = new GitHubCLIInstaller();


