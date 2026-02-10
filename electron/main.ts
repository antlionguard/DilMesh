import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { setupStoreHandlers, store } from './store'
import { LocalWhisperService } from './LocalWhisperService'
import { GcpSpeechService } from './GcpSpeechService'
import { GcpTranslationService } from './GcpTranslationService'
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
let gcpTranslationService: GcpTranslationService | null = null

// Per-window language preferences
const windowLanguagePreferences = new Map<string, string>() // windowId -> language code ('live', 'en', 'tr', etc.)

// Helper to broadcast to all projection windows with translation support
async function broadcastToProjectionWindows(channel: string, data: any) {
  for (const [windowId, win] of projectionWindows.entries()) {
    if (!win.isDestroyed()) {
      // Get language preference for this window
      const language = windowLanguagePreferences.get(windowId) || 'live'

      // If it's a transcript update and translation is needed
      if (channel === 'transcript-update' && language !== 'live' && data.text) {
        // Translate the text if translation service is available
        if (gcpTranslationService && gcpTranslationService.isReady()) {
          try {
            const translatedText = await gcpTranslationService.translate(
              data.text,
              language
            )
            // Send translated version to this window
            win.webContents.send(channel, { ...data, text: translatedText })
          } catch (error) {
            console.error(`Translation failed for window ${windowId}:`, error)
            // Fallback to original text
            win.webContents.send(channel, data)
          }
        } else {
          // No translation service, send original
          win.webContents.send(channel, data)
        }
      } else {
        // No translation needed, send original
        win.webContents.send(channel, data)
      }
    }
  }
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

    // Setup broadcast listeners for GCP Speech
    gcpSpeechService.on('transcript', (result) => {
      console.log('[Main] Broadcasting GCP transcript:', result.text)
      broadcastToProjectionWindows('transcript-update', result)
    })
  }

  if (!gcpTranslationService) {
    gcpTranslationService = new GcpTranslationService()
    // Initialize with GCP credentials from settings if available
    try {
      const settings: any = store.get('transcription')
      if (settings?.gcpKeyJson) {
        gcpTranslationService.initialize(settings.gcpKeyJson)
      }
    } catch (error) {
      console.log('No translation credentials found, translation will be disabled')
    }
  }

  // Note: GcpSpeechService will emit transcript events that we listen to above

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

  ipcMain.handle('update-projection-settings', (_, { id, ...settings }: { id: string, [key: string]: any }) => {
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
            windowLanguagePreferences.delete(id) // Clean up language preference
          }
        }
      ])
      contextMenu.popup({ window: win })
    })
  })

  // Handler to set window language preference
  ipcMain.handle('set-window-language', (_, { windowId, language }) => {
    windowLanguagePreferences.set(windowId, language)
    console.log(`Window ${windowId} language set to: ${language}`)
  })

  // Handler to get window language preference
  ipcMain.handle('get-window-language', (_, { windowId }) => {
    return windowLanguagePreferences.get(windowId) || 'live'
  })



  new ModelService() // Initialize handlers

  ipcMain.handle('start-local-transcription', async (_, { deviceId, language, model }) => {
    const id = parseInt(deviceId, 10) || 0
    const settings = store.get('transcription')
    if (localWhisperService) {
      localWhisperService.start(id, language || 'auto', model || 'small', settings)
    }
  })

  ipcMain.handle('stop-local-transcription', async () => {
    if (localWhisperService) {
      localWhisperService.stop()
    }
  })

})

