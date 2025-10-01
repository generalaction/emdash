import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getStatus as gitGetStatus, getFileDiff as gitGetFileDiff } from '../services/GitService'

const execAsync = promisify(exec)

export function registerGitIpc() {
  // Git: Status (moved from Codex IPC)
  ipcMain.handle('git:get-status', async (_, workspacePath: string) => {
    try {
      const changes = await gitGetStatus(workspacePath)
      return { success: true, changes }
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) }
    }
  })

  // Git: Per-file diff (moved from Codex IPC)
  ipcMain.handle(
    'git:get-file-diff',
    async (_, args: { workspacePath: string; filePath: string }) => {
      try {
        const diff = await gitGetFileDiff(args.workspacePath, args.filePath)
        return { success: true, diff }
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) }
      }
    }
  )
  // Git: Create Pull Request via GitHub CLI
  ipcMain.handle(
    'git:create-pr',
    async (
      _,
      args: {
        workspacePath: string
        title?: string
        body?: string
        base?: string
        head?: string
        draft?: boolean
        web?: boolean
        fill?: boolean
      }
    ) => {
      const { workspacePath, title, body, base, head, draft, web, fill } = args || ({} as any)
      try {
        const outputs: string[] = []

        // Stage and commit any pending changes
        try {
          const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd: workspacePath })
          if (statusOut && statusOut.trim().length > 0) {
            const { stdout: addOut, stderr: addErr } = await execAsync('git add -A', { cwd: workspacePath })
            if (addOut?.trim()) outputs.push(addOut.trim())
            if (addErr?.trim()) outputs.push(addErr.trim())

            const commitMsg = 'stagehand: prepare pull request'
            try {
              const { stdout: commitOut, stderr: commitErr } = await execAsync(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: workspacePath })
              if (commitOut?.trim()) outputs.push(commitOut.trim())
              if (commitErr?.trim()) outputs.push(commitErr.trim())
            } catch (commitErr: any) {
              const msg = commitErr?.stderr || commitErr?.message || String(commitErr)
              if (msg && /nothing to commit/i.test(msg)) {
                outputs.push('git commit: nothing to commit')
              } else {
                throw commitErr
              }
            }
          }
        } catch (stageErr) {
          console.warn('Failed to stage/commit changes before PR:', stageErr)
          // Continue; PR may still be created for existing commits
        }

        // Ensure branch is pushed to origin so PR includes latest commit
        try {
          await execAsync('git push', { cwd: workspacePath })
          outputs.push('git push: success')
        } catch (pushErr: any) {
          try {
            const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath })
            const branch = branchOut.trim()
            await execAsync(`git push --set-upstream origin ${JSON.stringify(branch)}`, { cwd: workspacePath })
            outputs.push(`git push --set-upstream origin ${branch}: success`)
          } catch (pushErr2) {
            console.error('Failed to push branch before PR:', pushErr2)
            return { success: false, error: 'Failed to push branch to origin. Please check your Git remotes and authentication.' }
          }
        }

        // Build gh pr create command
        const flags: string[] = []
        if (title) flags.push(`--title ${JSON.stringify(title)}`)
        if (body) flags.push(`--body ${JSON.stringify(body)}`)
        if (base) flags.push(`--base ${JSON.stringify(base)}`)
        if (head) flags.push(`--head ${JSON.stringify(head)}`)
        if (draft) flags.push('--draft')
        if (web) flags.push('--web')
        if (fill) flags.push('--fill')

        const cmd = `gh pr create ${flags.join(' ')}`.trim()

        const { stdout, stderr } = await execAsync(cmd, { cwd: workspacePath })
        const out = [...outputs, ((stdout || '').trim() || (stderr || '').trim())].filter(Boolean).join('\n')

        // Try to extract PR URL from output
        const urlMatch = out.match(/https?:\/\/\S+/)
        const url = urlMatch ? urlMatch[0] : null

        return { success: true, url, output: out }
      } catch (error: any) {
        console.error('Failed to create PR:', error)
        return { success: false, error: error?.message || String(error) }
      }
    }
  )

  // Git: Get PR status for current branch via GitHub CLI
  ipcMain.handle(
    'git:get-pr-status',
    async (
      _,
      args: { workspacePath: string }
    ) => {
      const { workspacePath } = args || ({} as any)
      try {
        // Ensure we're in a git repo
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: workspacePath })

        const queryFields = [
          'number',
          'url',
          'state',
          'isDraft',
          'mergeStateStatus',
          'headRefName',
          'baseRefName',
          'title',
          'author',
        ]
        const cmd = `gh pr view --json ${queryFields.join(',')} -q .`
        try {
          const { stdout } = await execAsync(cmd, { cwd: workspacePath })
          const json = (stdout || '').trim()
          const data = json ? JSON.parse(json) : null
          if (!data) return { success: false, error: 'No PR data returned' }
          return { success: true, pr: data }
        } catch (err: any) {
          const msg = String(err?.stderr || err?.message || '')
          if (/no pull requests? found/i.test(msg) || /not found/i.test(msg)) {
            return { success: true, pr: null }
          }
          return { success: false, error: msg || 'Failed to query PR status' }
        }
      } catch (error: any) {
        return { success: false, error: error?.message || String(error) }
      }
    }
  )

  // Git: Commit all changes and push current branch (create feature branch if on default)
  ipcMain.handle(
    'git:commit-and-push',
    async (
      _,
      args: {
        workspacePath: string
        commitMessage?: string
        createBranchIfOnDefault?: boolean
        branchPrefix?: string
      }
    ) => {
      const {
        workspacePath,
        commitMessage = 'chore: apply workspace changes',
        createBranchIfOnDefault = true,
        branchPrefix = 'orch',
      } = (args || ({} as any)) as {
        workspacePath: string
        commitMessage?: string
        createBranchIfOnDefault?: boolean
        branchPrefix?: string
      }

      try {
        // Ensure we're in a git repo
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: workspacePath })

        // Determine current branch
        const { stdout: currentBranchOut } = await execAsync('git branch --show-current', { cwd: workspacePath })
        const currentBranch = (currentBranchOut || '').trim()

        // Determine default branch via gh, fallback to main/master
        let defaultBranch = 'main'
        try {
          const { stdout } = await execAsync('gh repo view --json defaultBranchRef -q .defaultBranchRef.name', { cwd: workspacePath })
          const db = (stdout || '').trim()
          if (db) defaultBranch = db
        } catch {
          try {
            const { stdout } = await execAsync('git remote show origin | sed -n "/HEAD branch/s/.*: //p"', { cwd: workspacePath })
            const db2 = (stdout || '').trim()
            if (db2) defaultBranch = db2
          } catch {}
        }

        // Optionally create a new branch if on default
        let activeBranch = currentBranch
        if (createBranchIfOnDefault && (!currentBranch || currentBranch === defaultBranch)) {
          const short = Date.now().toString(36)
          const name = `${branchPrefix}/${short}`
          await execAsync(`git checkout -b ${JSON.stringify(name)}`, { cwd: workspacePath })
          activeBranch = name
        }

        // Stage all and commit if there are changes
        try {
          const { stdout: st } = await execAsync('git status --porcelain', { cwd: workspacePath })
          if (st && st.trim().length > 0) {
            await execAsync('git add -A', { cwd: workspacePath })
            try {
              await execAsync(`git commit -m ${JSON.stringify(commitMessage)}`, { cwd: workspacePath })
            } catch (commitErr: any) {
              const msg = commitErr?.stderr || commitErr?.message || ''
              if (!/nothing to commit/i.test(msg)) throw commitErr
            }
          }
        } catch (e) {
          console.warn('Stage/commit step issue:', e)
        }

        // Push current branch (set upstream if needed)
        try {
          await execAsync('git push', { cwd: workspacePath })
        } catch (pushErr) {
          await execAsync(`git push --set-upstream origin ${JSON.stringify(activeBranch)}`, { cwd: workspacePath })
        }

        const { stdout: out } = await execAsync('git status -sb', { cwd: workspacePath })
        return { success: true, branch: activeBranch, output: (out || '').trim() }
      } catch (error: any) {
        console.error('Failed to commit and push:', error)
        return { success: false, error: error?.message || String(error) }
      }
    }
  )

}
