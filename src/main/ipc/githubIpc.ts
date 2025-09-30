import { ipcMain } from 'electron'
import { GitHubService } from '../services/GitHubService'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const githubService = new GitHubService()
const GH_PATH = '/opt/homebrew/bin/gh'

export function registerGithubIpc() {
  ipcMain.handle('github:connect', async (_, projectPath: string) => {
    try {
      console.log('[GitHub IPC] Connecting to GitHub for project:', projectPath)

      // Check if GitHub CLI is authenticated
      const isAuth = await githubService.isAuthenticated()
      console.log('[GitHub IPC] Authentication check result:', isAuth)

      if (!isAuth) {
        console.log('[GitHub IPC] Not authenticated')
        return { success: false, error: 'GitHub CLI not authenticated' }
      }

      // Get repository info from GitHub CLI
      try {
        console.log('[GitHub IPC] Running gh repo view command with path:', GH_PATH)
        const { stdout } = await execAsync(`${GH_PATH} repo view --json name,nameWithOwner,defaultBranchRef`, { cwd: projectPath })
        console.log('[GitHub IPC] gh repo view output:', stdout)
        const repoInfo = JSON.parse(stdout)

        return {
          success: true,
          repository: repoInfo.nameWithOwner,
          branch: repoInfo.defaultBranchRef?.name || 'main'
        }
      } catch (error) {
        console.error('[GitHub IPC] gh repo view failed:', error)
        return {
          success: false,
          error: 'Repository not found on GitHub or not connected to GitHub CLI'
        }
      }
    } catch (error) {
      console.error('[GitHub IPC] Failed to connect to GitHub:', error)
      return { success: false, error: 'Failed to connect to GitHub' }
    }
  })

  ipcMain.handle('github:auth', async () => {
    try {
      return await githubService.authenticate()
    } catch (error) {
      console.error('GitHub authentication failed:', error)
      return { success: false, error: 'Authentication failed' }
    }
  })

  ipcMain.handle('github:isAuthenticated', async () => {
    try {
      return await githubService.isAuthenticated()
    } catch (error) {
      console.error('GitHub authentication check failed:', error)
      return false
    }
  })

  // GitHub status: installed + authenticated + user
  ipcMain.handle('github:getStatus', async () => {
    try {
      console.log('[GitHub Status] Checking GitHub status...')

      let installed = true
      try {
        await execAsync(`${GH_PATH} --version`)
        console.log('[GitHub Status] GitHub CLI is installed')
      } catch (error) {
        console.log('[GitHub Status] GitHub CLI not found:', error)
        installed = false
      }

      let authenticated = false
      let user: any = null
      if (installed) {
        try {
          console.log('[GitHub Status] Checking authentication with token')
          const token = process.env.GITHUB_TOKEN || ''
          user = await githubService.getUserInfo(token)
          authenticated = !!user
          console.log('[GitHub Status] Authentication successful, user:', user?.login)
        } catch (error) {
          console.log('[GitHub Status] Authentication failed:', error)
          authenticated = false
          user = null
        }
      }

      const result = { installed, authenticated, user }
      console.log('[GitHub Status] Final result:', result)
      return result
    } catch (error) {
      console.error('[GitHub Status] Status check failed:', error)
      return { installed: false, authenticated: false }
    }
  })

  ipcMain.handle('github:getUser', async () => {
    try {
      const token = await (githubService as any)['getStoredToken']()
      if (!token) return null
      return await githubService.getUserInfo(token)
    } catch (error) {
      console.error('Failed to get user info:', error)
      return null
    }
  })

  ipcMain.handle('github:getRepositories', async () => {
    try {
      const token = await (githubService as any)['getStoredToken']()
      if (!token) throw new Error('Not authenticated')
      return await githubService.getRepositories(token)
    } catch (error) {
      console.error('Failed to get repositories:', error)
      return []
    }
  })

  ipcMain.handle('github:cloneRepository', async (_, repoUrl: string, localPath: string) => {
    try {
      return await githubService.cloneRepository(repoUrl, localPath)
    } catch (error) {
      console.error('Failed to clone repository:', error)
      return { success: false, error: 'Clone failed' }
    }
  })

  ipcMain.handle('github:logout', async () => {
    try {
      await githubService.logout()
    } catch (error) {
      console.error('Failed to logout:', error)
    }
  })
}

