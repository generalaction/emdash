import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

export interface WorktreeInfo {
  id: string;
  name: string;
  branch: string;
  path: string;
  projectId: string;
  status: "active" | "paused" | "completed" | "error";
  createdAt: string;
  lastActivity?: string;
}

export class WorktreeService {
  private worktrees = new Map<string, WorktreeInfo>();

  private async cleanupWorktreeDirectory(pathToRemove: string): Promise<void> {
    try {
      await fs.promises.rm(pathToRemove, { recursive: true, force: true });
    } catch (error) {
      console.warn("Failed to cleanup worktree directory:", error);
    }
  }

  /**
   * Create a new Git worktree for an agent workspace
   */
  async createWorktree(
    projectPath: string,
    workspaceName: string,
    projectId: string,
  ): Promise<WorktreeInfo> {
    try {
      // Generate unique branch name with more randomness
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      const branchName = `agent/${workspaceName}-${timestamp}-${random}`;
      const worktreePath = path.join(
        projectPath,
        "..",
        `worktrees/${workspaceName}-${timestamp}`,
      );

      console.log(`Creating worktree: ${branchName} -> ${worktreePath}`);

      // Check if worktree path already exists
      if (fs.existsSync(worktreePath)) {
        throw new Error(`Worktree directory already exists: ${worktreePath}`);
      }

      // Ensure worktrees directory exists
      const worktreesDir = path.dirname(worktreePath);
      if (!fs.existsSync(worktreesDir)) {
        fs.mkdirSync(worktreesDir, { recursive: true });
      }

      // Create the worktree
      const { stdout, stderr } = await execAsync(
        `git worktree add -b "${branchName}" "${worktreePath}"`,
        { cwd: projectPath },
      );

      console.log("Git worktree stdout:", stdout);
      console.log("Git worktree stderr:", stderr);

      // Check for errors in stderr
      if (
        stderr &&
        !stderr.includes("Switched to a new branch") &&
        !stderr.includes("Preparing worktree")
      ) {
        throw new Error(`Git worktree creation failed: ${stderr}`);
      }

      // Verify the worktree was actually created
      if (!fs.existsSync(worktreePath)) {
        throw new Error(`Worktree directory was not created: ${worktreePath}`);
      }

      // Ensure codex logs are ignored in this worktree
      try {
        const gitMeta = path.join(worktreePath, ".git");
        let gitDir = gitMeta;
        if (fs.existsSync(gitMeta) && fs.statSync(gitMeta).isFile()) {
          try {
            const content = fs.readFileSync(gitMeta, "utf8");
            const m = content.match(/gitdir:\s*(.*)\s*$/i);
            if (m && m[1]) {
              gitDir = path.resolve(worktreePath, m[1].trim());
            }
          } catch {}
        }
        const excludePath = path.join(gitDir, "info", "exclude");
        try {
          const dir = path.dirname(excludePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          let current = "";
          try {
            current = fs.readFileSync(excludePath, "utf8");
          } catch {}
          if (!current.includes("codex-stream.log")) {
            fs.appendFileSync(
              excludePath,
              (current.endsWith("\n") || current === "" ? "" : "\n") +
                "codex-stream.log\n",
            );
          }
        } catch {}
      } catch {}

      const worktreeInfo: WorktreeInfo = {
        id: `${projectId}-${workspaceName}`,
        name: workspaceName,
        branch: branchName,
        path: worktreePath,
        projectId,
        status: "active",
        createdAt: new Date().toISOString(),
      };

      this.worktrees.set(worktreeInfo.id, worktreeInfo);

      console.log(`Created worktree: ${workspaceName} -> ${branchName}`);

      // Push the new branch to origin and set upstream so PRs work out of the box
      try {
        await execAsync(
          `git push --set-upstream origin ${JSON.stringify(branchName)}`,
          {
            cwd: worktreePath,
          },
        );
        console.log(
          `Pushed branch ${branchName} to origin with upstream tracking`,
        );
      } catch (pushErr) {
        console.warn("Initial push of worktree branch failed:", pushErr);
        // Don't fail worktree creation if push fails - user can push manually later
      }

      return worktreeInfo;
    } catch (error) {
      console.error("Failed to create worktree:", error);
      throw new Error(`Failed to create worktree: ${error}`);
    }
  }

  /**
   * List all worktrees for a project
   */
  async listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
    try {
      const { stdout } = await execAsync("git worktree list", {
        cwd: projectPath,
      });

      const worktrees: WorktreeInfo[] = [];
      const lines = stdout.trim().split("\n");

      for (const line of lines) {
        if (line.includes("[") && line.includes("]")) {
          const parts = line.split(/\s+/);
          const worktreePath = parts[0];
          const branchMatch = line.match(/\[([^\]]+)\]/);
          const branch = branchMatch ? branchMatch[1] : "unknown";

          // Only include worktrees that are agent workspaces
          if (branch.startsWith("agent/")) {
            const workspaceName = path.basename(worktreePath);
            worktrees.push({
              id: `${path.basename(projectPath)}-${workspaceName}`,
              name: workspaceName,
              branch,
              path: worktreePath,
              projectId: path.basename(projectPath),
              status: "active",
              createdAt: new Date().toISOString(),
            });
          }
        }
      }

      return worktrees;
    } catch (error) {
      console.error("Failed to list worktrees:", error);
      return [];
    }
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(
    projectPath: string,
    worktreeId: string,
    worktreePath?: string,
    branch?: string,
  ): Promise<void> {
    try {
      let worktree = this.worktrees.get(worktreeId);

      let pathToRemove = worktree?.path ?? worktreePath;
      let branchToDelete = worktree?.branch ?? branch;

      if (!pathToRemove) {
        throw new Error("Worktree path not provided");
      }

      // Remove the worktree directory via git first
      try {
        await execAsync(`git worktree remove "${pathToRemove}"`, {
          cwd: projectPath,
        });
      } catch (gitError) {
        console.warn(
          "git worktree remove failed, attempting filesystem cleanup",
          gitError,
        );
      }

      // Ensure directory is removed even if git command failed
      void this.cleanupWorktreeDirectory(pathToRemove);

      if (branchToDelete) {
        try {
          await execAsync(`git branch -D ${branchToDelete}`, {
            cwd: projectPath,
          });
        } catch (branchError) {
          console.warn(
            `Failed to delete branch ${branchToDelete}:`,
            branchError,
          );
        }
      }

      if (worktree) {
        this.worktrees.delete(worktreeId);
        console.log(`Removed worktree: ${worktree.name}`);
      } else {
        console.log(`Removed worktree ${worktreeId}`);
      }
    } catch (error) {
      console.error("Failed to remove worktree:", error);
      throw new Error(`Failed to remove worktree: ${error}`);
    }
  }

  /**
   * Get worktree status and changes
   */
  async getWorktreeStatus(worktreePath: string): Promise<{
    hasChanges: boolean;
    stagedFiles: string[];
    unstagedFiles: string[];
    untrackedFiles: string[];
  }> {
    try {
      const { stdout: status } = await execAsync("git status --porcelain", {
        cwd: worktreePath,
      });

      const stagedFiles: string[] = [];
      const unstagedFiles: string[] = [];
      const untrackedFiles: string[] = [];

      const lines = status
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);

      for (const line of lines) {
        const status = line.substring(0, 2);
        const file = line.substring(3);

        if (
          status.includes("A") ||
          status.includes("M") ||
          status.includes("D")
        ) {
          stagedFiles.push(file);
        }
        if (status.includes("M") || status.includes("D")) {
          unstagedFiles.push(file);
        }
        if (status.includes("??")) {
          untrackedFiles.push(file);
        }
      }

      return {
        hasChanges:
          stagedFiles.length > 0 ||
          unstagedFiles.length > 0 ||
          untrackedFiles.length > 0,
        stagedFiles,
        unstagedFiles,
        untrackedFiles,
      };
    } catch (error) {
      console.error("Failed to get worktree status:", error);
      return {
        hasChanges: false,
        stagedFiles: [],
        unstagedFiles: [],
        untrackedFiles: [],
      };
    }
  }

  /**
   * Merge worktree changes back to main branch
   */
  async mergeWorktreeChanges(
    projectPath: string,
    worktreeId: string,
  ): Promise<void> {
    try {
      const worktree = this.worktrees.get(worktreeId);
      if (!worktree) {
        throw new Error("Worktree not found");
      }

      // Switch to main branch
      await execAsync("git checkout main", { cwd: projectPath });

      // Merge the worktree branch
      await execAsync(`git merge ${worktree.branch}`, { cwd: projectPath });

      // Remove the worktree
      await this.removeWorktree(projectPath, worktreeId);

      console.log(`Merged worktree changes: ${worktree.name}`);
    } catch (error) {
      console.error("Failed to merge worktree changes:", error);
      throw new Error(`Failed to merge worktree changes: ${error}`);
    }
  }

  /**
   * Get worktree by ID
   */
  getWorktree(worktreeId: string): WorktreeInfo | undefined {
    return this.worktrees.get(worktreeId);
  }

  /**
   * Get all worktrees
   */
  getAllWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }
}

export const worktreeService = new WorktreeService();
