import { ipcMain, WebContents } from 'electron'
import { startPty, writePty, resizePty, killPty, hasPty } from './ptyManager'

const owners = new Map<string, WebContents>()

export function registerPtyIpc(): void {
  ipcMain.handle('pty:start', (event, args: {
    id: string,
    cwd?: string,
    shell?: string,
    env?: Record<string, string>,
    cols?: number,
    rows?: number,
  }) => {
    try {
      const { id, cwd, shell, env, cols, rows } = args
      const proc = startPty({ id, cwd, shell, env, cols, rows })
      console.log('pty:start OK', { id, cwd, shell, cols, rows })
      const wc = event.sender
      owners.set(id, wc)

      proc.onData((data) => {
        owners.get(id)?.send(`pty:data:${id}`, data)
      })

      proc.onExit(({ exitCode, signal }) => {
        owners.get(id)?.send(`pty:exit:${id}`, { exitCode, signal })
        owners.delete(id)
      })

      return { ok: true }
    } catch (err: any) {
      console.error('pty:start FAIL', { id: args.id, cwd: args.cwd, shell: args.shell, error: err?.message || err })
      return { ok: false, error: String(err?.message || err) }
    }
  })

  ipcMain.on('pty:input', (_event, args: { id: string, data: string }) => {
    try {
      writePty(args.id, args.data)
    } catch (e) {
      console.error('pty:input error', e)
    }
  })

  ipcMain.on('pty:resize', (_event, args: { id: string, cols: number, rows: number }) => {
    try {
      if (!hasPty(args.id)) return
      resizePty(args.id, args.cols, args.rows)
    } catch (e) {
      console.error('pty:resize error', e)
    }
  })

  ipcMain.on('pty:kill', (_event, args: { id: string }) => {
    try {
      killPty(args.id)
    } catch (e) {
      console.error('pty:kill error', e)
    }
  })
}
