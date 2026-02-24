import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } from 'electron'
import { setupStoreHandlers, store } from './store'
import { LocalWhisperService } from './LocalWhisperService'
import { GcpSpeechService } from './GcpSpeechService'
import { GcpTranslationService } from './GcpTranslationService'
import { SileroVadService } from './SileroVadService'
import { SherpaOnnxSpeechService } from './SherpaOnnxSpeechService'
import { RivaSpeechService } from './RivaSpeechService'
import { NllbTranslationService } from './NllbTranslationService'
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
let tray: Tray | null = null

// Centralized transcription services
let localWhisperService: LocalWhisperService | null = null
let gcpSpeechService: GcpSpeechService | null = null
let gcpTranslationService: GcpTranslationService | null = null
let sileroVad: SileroVadService | null = null
let sherpaOnnxService: SherpaOnnxSpeechService | null = null
let rivaSpeechService: RivaSpeechService | null = null
let nllbTranslationService: NllbTranslationService | null = null

// Per-window language preferences
const windowLanguagePreferences = new Map<string, string>() // windowId -> language code ('live', 'en', 'tr', etc.)


// Helper to broadcast to all projection windows with translation support
async function broadcastToProjectionWindows(channel: string, data: any) {
  for (const [windowId, win] of projectionWindows.entries()) {
    if (!win.isDestroyed()) {
      // Get language preference for this window
      const language = windowLanguagePreferences.get(windowId) || 'live'
      const isTranslationWindow = language !== 'live'

      // Translation windows: ONLY accept sentence-level events — never interim.
      // This guarantees words don't flicker in real-time on translation projections.
      if (channel === 'transcript-update' && isTranslationWindow && !data.isSentence) {
        continue  // drop interim for translation windows
      }

      // If it's a transcript update and translation is needed
      if (channel === 'transcript-update' && isTranslationWindow && data.text && data.isSentence) {
        // Skip if source matches target (e.g., tr -> tr-TR)
        const sourceLang = (data.detectedLanguage || '').split('-')[0]
        const targetLang = language.split('-')[0]

        if (sourceLang && sourceLang === targetLang) {
          win.webContents.send(channel, data)
          continue
        }
        console.log(`[Main] Window ${windowId} translation needed. Target: ${language}, Source: ${data.detectedLanguage}`)

        // Translate the text if translation service is available
        if (gcpTranslationService && gcpTranslationService.isReady()) {
          try {
            const translatedText = await gcpTranslationService.translate(
              data.text,
              language,
              data.detectedLanguage // Use detected source language for better accuracy
            )
            console.log(`[Main] Translation result: "${translatedText}"`)
            // Send translated version to this window
            win.webContents.send(channel, { ...data, text: translatedText })
          } catch (error) {
            console.error(`Translation failed for window ${windowId}:`, error)
            // Fallback to original text
            win.webContents.send(channel, data)
          }
        } else {
          console.warn(`[Main] Translation service not ready for window ${windowId}`)
          // No translation service, send original
          win.webContents.send(channel, data)
        }
      } else {
        // Live window or non-transcript channel — send as-is
        win.webContents.send(channel, data)
      }
    }
  }
}

// Broadcast interim (live) transcripts — only to windows in 'live' mode
function broadcastLiveCaption(data: any) {
  for (const [windowId, win] of projectionWindows.entries()) {
    if (!win.isDestroyed()) {
      const language = windowLanguagePreferences.get(windowId) || 'live'
      if (language === 'live') {
        win.webContents.send('transcript-update', data)
      }
      // Translation windows intentionally skip live captions to avoid
      // showing raw source-language text before the translation arrives.
    }
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC, 'tray-icon.png'),
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

function createProjectionWindow(id: string, title: string = 'Projection') {
  const windowTitle = `${title} - DilMesh`
  const win = new BrowserWindow({
    width: 800,
    height: 200,
    title: windowTitle, // Set initial title

    // frame: false, // Frameless for subtitles
    titleBarStyle: 'hidden', // Hide title bar but keep traffic lights
    trafficLightPosition: { x: 10, y: 10 },
    transparent: true, // Transparent support
    hasShadow: false,
    icon: path.join(process.env.VITE_PUBLIC, 'tray-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    }
  })

  projectionWindows.set(id, win)

  const url = VITE_DEV_SERVER_URL
    ? `${VITE_DEV_SERVER_URL}#/projection/${id}?title=${encodeURIComponent(title)}`
    : `file://${path.join(RENDERER_DIST, 'index.html')}#/projection/${id}?title=${encodeURIComponent(title)}`

  win.loadURL(url)

  win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      {
        label: 'Close Window',
        click: () => win.close()
      }
    ]).popup({ window: win })
  })

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

function createTray() {
  const iconPath = path.join(process.env.VITE_PUBLIC, 'tray-icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  // Resize if needed, standard tray icons are small (16x16 or 22x22)
  tray = new Tray(icon.resize({ width: 22, height: 22 }))

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Dashboard',
      click: () => {
        if (mainWindow) {
          mainWindow.show()
          mainWindow.focus()
        } else {
          createMainWindow()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit DilMesh',
      click: () => {
        app.quit()
      }
    }
  ])

  tray.setToolTip('DilMesh')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
}

app.setName('DilMesh')

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
  }
})

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(process.env.VITE_PUBLIC, 'tray-icon.png'))
  }

  setupStoreHandlers()
  createTray()
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

  // Initialize Silero VAD
  if (!sileroVad) {
    sileroVad = new SileroVadService()
    // Try to initialize with settings
    try {
      const settings: any = store.get('transcription')
      const vadEnabled = settings?.vadEnabled ?? true
      sileroVad.initialize({
        enabled: vadEnabled,
        positiveSpeechThreshold: settings?.vadThreshold ?? 0.5,
        negativeSpeechThreshold: settings?.vadNegativeThreshold ?? 0.35,
        preSpeechPadFrames: settings?.vadPreSpeechPad ?? 1,
        redemptionFrames: settings?.vadRedemptionFrames ?? 8,
        minSpeechFrames: settings?.vadMinSpeechFrames ?? 3
      })
    } catch (error) {
      console.log('[Main] VAD initialization deferred, will passthrough audio')
    }
  }

  if (!gcpSpeechService) {
    gcpSpeechService = new GcpSpeechService()

    // Wire VAD as audio preprocessor for GCP
    // Audio flow: mic → GCP IPC handler → VAD.processAudio → audio-for-stt → writeAudio
    if (sileroVad) {
      gcpSpeechService.audioPreprocessor = (chunk: Buffer) => {
        sileroVad!.processAudio(chunk)
      }
      sileroVad.on('audio-for-stt', (audioChunk: Buffer) => {
        if (gcpSpeechService) {
          gcpSpeechService.writeAudio(audioChunk)
        }
      })
    }

    // ── Interim punctuation tracker ─────────────────────────────────────────────
    let translatedCharCount = 0
    let lastInterimLanguage = ''   // reset char count when language flips
    let sentenceSeq = 0            // monotonic sequence number for queue ordering
    const PUNCT_RE = /[.!?…;,]/g
    const MIN_CLAUSE_LENGTH = 5    // ignore tiny fragments like "yeah,"

    function findLastPunctIndex(text: string, afterPos: number): number {
      let lastIdx = -1
      PUNCT_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = PUNCT_RE.exec(text)) !== null) {
        if (m.index >= afterPos) lastIdx = m.index
      }
      return lastIdx
    }

    gcpSpeechService.on('transcript', (result) => {
      if (!result.isFinal) {
        // Send live captions to 'live' windows
        broadcastLiveCaption({ ...result, isSentence: false })

        // Reset char counter if language flipped (different stream won)
        const lang = result.detectedLanguage || ''
        if (lang !== lastInterimLanguage) {
          if (lastInterimLanguage) {
            console.log(`[Main] Language flip ${lastInterimLanguage} → ${lang}, resetting char counter`)
          }
          translatedCharCount = 0
          lastInterimLanguage = lang
        }

        // Check for new punctuation in growing interim text
        const text = result.text || ''
        const punctIdx = findLastPunctIndex(text, translatedCharCount)

        if (punctIdx >= 0) {
          const clause = text.substring(translatedCharCount, punctIdx + 1).trim()
          if (clause.length >= MIN_CLAUSE_LENGTH) {
            translatedCharCount = punctIdx + 1
            const seq = ++sentenceSeq
            console.log(`[Main] Interim punct → translating (${lang}) [seq=${seq}]: "${clause}"`)
            void broadcastToProjectionWindows('transcript-update', {
              provider: 'GCP',
              text: clause,
              isFinal: false,
              confidence: result.confidence,
              detectedLanguage: lang,
              isSentence: true,
              seq
            })
          }
        }
        return
      }

      // Final result: flush any remaining untranslated suffix
      const finalText = (result.text || '').trim()
      const remaining = finalText.substring(translatedCharCount).trim()
      translatedCharCount = 0  // reset for next utterance

      if (remaining.length > 0) {
        const seq = ++sentenceSeq
        console.log(`[Main] Final flush remaining [seq=${seq}]: "${remaining}"`)
        void broadcastToProjectionWindows('transcript-update', {
          ...result,
          text: remaining,
          isSentence: true,
          seq
        })
      }
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

  // ── Initialize Sherpa-ONNX STT ──────────────────────────────────────────
  if (!sherpaOnnxService) {
    sherpaOnnxService = new SherpaOnnxSpeechService()

    // Wire VAD as audio preprocessor for Sherpa-ONNX
    if (sileroVad) {
      sherpaOnnxService.audioPreprocessor = (chunk: Buffer) => {
        sileroVad!.processAudio(chunk)
      }
      sileroVad.on('audio-for-stt', (audioChunk: Buffer) => {
        if (sherpaOnnxService) {
          sherpaOnnxService.writeAudio(audioChunk)
        }
      })
    }

    // Sherpa-ONNX transcript events → same pipeline as GCP
    sherpaOnnxService.on('transcript', (result: any) => {
      broadcastToProjectionWindows('transcription-result', {
        text: result.text,
        isFinal: result.isFinal,
        language: result.language,
        provider: 'SHERPA_ONNX',
        confidence: result.confidence
      })
    })

    sherpaOnnxService.on('error', (error) => {
      console.error('[Main] Sherpa-ONNX error:', error)
    })
  }

  // ── Initialize Riva STT + NMT ───────────────────────────────────────────
  if (!rivaSpeechService) {
    rivaSpeechService = new RivaSpeechService()

    // Wire VAD as audio preprocessor for Riva
    if (sileroVad) {
      rivaSpeechService.audioPreprocessor = (chunk: Buffer) => {
        sileroVad!.processAudio(chunk)
      }
      sileroVad.on('audio-for-stt', (audioChunk: Buffer) => {
        if (rivaSpeechService) {
          rivaSpeechService.writeAudio(audioChunk)
        }
      })
    }

    // Riva transcript events → same pipeline as GCP/Sherpa
    rivaSpeechService.on('transcript', (result: any) => {
      broadcastToProjectionWindows('transcription-result', {
        text: result.text,
        isFinal: result.isFinal,
        language: result.language,
        provider: 'RIVA',
        confidence: result.confidence
      })
    })

    rivaSpeechService.on('error', (error) => {
      console.error('[Main] Riva error:', error)
    })
  }

  // ── Initialize NLLB Translation ──────────────────────────────────────────
  if (!nllbTranslationService) {
    nllbTranslationService = new NllbTranslationService()

    // Initialize NLLB on demand via IPC
    ipcMain.handle('initialize-nllb', async () => {
      return nllbTranslationService?.initialize()
    })

    ipcMain.handle('nllb-translate', async (_, text: string, targetLang: string, sourceLang?: string) => {
      if (!nllbTranslationService?.isReady()) {
        throw new Error('NLLB model not loaded')
      }
      return nllbTranslationService.translate(text, targetLang, sourceLang)
    })
  }

  ipcMain.handle('create-projection-window', (_, args: any) => {
    // Handle both old (string ID) and new (object) formats for backward compatibility
    const id = typeof args === 'string' ? args : args.id
    const title = typeof args === 'object' ? args.title : undefined

    if (projectionWindows.has(id)) {
      const existing = projectionWindows.get(id)
      if (existing && !existing.isDestroyed()) {
        if (title) existing.setTitle(`${title} - DilMesh`)
        existing.show()
        existing.focus()
        return
      }
    }
    createProjectionWindow(id, title)
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
    if (win && !win.isDestroyed()) {
      if (settings.title) {
        win.setTitle(`${settings.title} - DilMesh`)
      }
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
    // Notify the window itself so Projection.vue can update its display mode
    const win = projectionWindows.get(windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('language-mode-updated', { language })
    }
  })

  // Handler to get window language preference
  ipcMain.handle('get-window-language', (_, { windowId }) => {
    return windowLanguagePreferences.get(windowId) || 'live'
  })

  // Handler to update GCP credentials dynamically
  ipcMain.handle('update-gcp-credentials', (_, keyJson) => {
    if (gcpTranslationService) {
      console.log('Updating GCP credentials for Translation Service...')
      return gcpTranslationService.initialize(keyJson)
    }
    return false
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

