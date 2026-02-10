import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { setupStoreHandlers, store } from './store'
import { LocalWhisperService } from './LocalWhisperService'
import { GcpSpeechService } from './GcpSpeechService'
// import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { ModelService } from './ModelService'

// const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let mainWindow: BrowserWindow | null
const projectionWindows = new Map<string, BrowserWindow>()

// Centralized transcription services
let localWhisperService: LocalWhisperService | null = null
let gcpSpeechService: GcpSpeechService | null = null

// Helper to broadcast to all projection windows
function broadcastToProjectionWindows(channel: string, data: any) {
  projectionWindows.forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  })
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function createProjectionWindow(id: string) {
  const win = new BrowserWindow({
    width: 800,
    height: 200,
    // frame: false, // Frameless for subtitles
    titleBarStyle: 'hidden', // Hide title bar but keep traffic lights
    trafficLightPosition: { x: 10, y: 10 },
    transparent: true, // Transparent support
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    }
  })

  projectionWindows.set(id, win)

  const url = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}#/projection/${id}`
    : `file://${path.join(RENDERER_DIST, 'index.html')}#/projection/${id}`

  win.loadURL(url)

  win.on('closed', () => {
    projectionWindows.delete(id)
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    mainWindow = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})

app.whenReady().then(() => {
  setupStoreHandlers()
  createMainWindow()

  // Initialize centralized transcription services (only once)
  if (!localWhisperService) {
    localWhisperService = new LocalWhisperService()

    // Setup broadcast listeners for LocalWhisper
    localWhisperService.on('transcript', (result) => {
      console.log('[Main] Broadcasting LocalWhisper transcript:', result.text)
      broadcastToProjectionWindows('transcript-update', result)
    })

    localWhisperService.on('error', (error) => {
      console.error('[Main] LocalWhisper error:', error)
    })
  }

  if (!gcpSpeechService) {
    gcpSpeechService = new GcpSpeechService()
  }

  // Note: GcpSpeechService will broadcast internally in its stream handler

  ipcMain.handle('create-projection-window', (_, id) => {
    if (projectionWindows.has(id)) {
      const existing = projectionWindows.get(id)
      if (existing && !existing.isDestroyed()) {
        existing.show()
        existing.focus()
        return
      }
    }
    createProjectionWindow(id)
  })

  ipcMain.handle('get-active-windows', () => {
    return Array.from(projectionWindows.keys())
  })

  ipcMain.handle('close-projection-window', (_, id) => {
    const win = projectionWindows.get(id)
    if (win) {
      win.close()
      projectionWindows.delete(id)
    }
  })

  ipcMain.handle('update-projection-settings', (_, { id, ...settings }) => {
    const win = projectionWindows.get(id)
    if (win) {
      win.webContents.send('settings-updated', settings)
    }
  })

  ipcMain.handle('bring-to-front', (_, { id }) => {
    const win = projectionWindows.get(id)
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      win.moveTop()
    }
  })

  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      label: d.label,
      bounds: d.bounds
    }))
  })

  ipcMain.handle('move-to-display', (_, { windowId, displayId }) => {
    const win = projectionWindows.get(windowId)
    const display = screen.getAllDisplays().find(d => d.id === displayId)

    if (win && display) {
      const { x, y, width, height } = display.bounds
      win.setBounds({ x, y, width, height })
      win.setSimpleFullScreen(true) // or win.setFullScreen(true)
    }
  })


  ipcMain.handle('show-context-menu', (_, { id }) => {
    const win = projectionWindows.get(id)
    if (!win) return

    import('electron').then(({ Menu }) => {
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Close Window',
          click: () => {
            win.close()
            projectionWindows.delete(id)
          }
        }
      ])
      contextMenu.popup({ window: win })
    })
  })



  new ModelService() // Initialize handlers
  const localWhisper = new LocalWhisperService()
  new GcpSpeechService() // Initialize GCP handlers

  ipcMain.handle('start-local-transcription', async (_, { deviceId, language, model }) => {
    const id = parseInt(deviceId, 10) || 0
    const settings = await store.get('transcription')
    localWhisper.start(id, language || 'auto', model || 'small', settings)
  })

  ipcMain.handle('stop-local-transcription', async () => {
    localWhisper.stop()
  })

  localWhisper.on('transcription', (text) => {
    for (const win of projectionWindows.values()) {
      win.webContents.send('transcript-update', {
        text,
        isFinal: false,
        provider: 'LOCAL'
      })
    }
  })
})

