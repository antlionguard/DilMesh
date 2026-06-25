import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog } from 'electron'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { setupStoreHandlers, store } from './store'
import { ObsServer } from './ObsServer'
import { LocalWhisperService } from './LocalWhisperService'
import { GcpSpeechService } from './GcpSpeechService'
import { GcpTranslationService } from './GcpTranslationService'
import { SileroVadService } from './SileroVadService'
import { SherpaOnnxSpeechService } from './SherpaOnnxSpeechService'
import { RivaSpeechService } from './RivaSpeechService'
import { DeepgramSpeechService } from './DeepgramSpeechService'
import { NllbTranslationService } from './NllbTranslationService'
import { DeepLTranslationService } from './DeepLTranslationService'
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
let deepgramSpeechService: DeepgramSpeechService | null = null
let nllbTranslationService: NllbTranslationService | null = null
let deeplTranslationService: DeepLTranslationService | null = null

// Per-window language layers
interface LanguageLayer {
  id: string
  language: string
  positionX: number
  positionY: number
  fontSize: number
  fontFamily: string
  textColor: string
  maxLines: number
  maxWidth: number   // px, 0 = unlimited (full screen width)
}

const windowLanguageLayers = new Map<string, LanguageLayer[]>() // windowId -> language layers

// Per-window shared style (background, shadow, alignment) — kept for OBS overlay config
const windowStyles = new Map<string, any>() // windowId -> WindowStyle

// OBS HTTP/WebSocket server (Browser Source output)
let obsServer: ObsServer | null = null

// Backgrounds directory: userData/backgrounds/{uuid}.{ext}
const backgroundsDir = path.join(app.getPath('userData'), 'backgrounds')
function ensureBackgroundsDir() {
  try {
    if (!fs.existsSync(backgroundsDir)) fs.mkdirSync(backgroundsDir, { recursive: true })
  } catch (e) {
    console.error('[Main] Failed to create backgrounds dir:', e)
  }
}


// Send a transcript payload both to the Electron projection window (if open) and
// to any connected OBS Browser Source clients for that window/preset.
function sendTranscript(win: BrowserWindow | undefined, windowId: string, payload: any) {
  if (win && !win.isDestroyed()) win.webContents.send('transcript-update', payload)
  obsServer?.broadcastTranscript(windowId, payload)
}

// Resolve the language layers for a target — from memory if a window is open,
// otherwise from the persisted preset (so OBS works without an open window).
function resolveLayersForTarget(windowId: string): LanguageLayer[] {
  const inMemory = windowLanguageLayers.get(windowId)
  if (inMemory) return inMemory
  try {
    const presets: any[] = (store.get('project-state') as any[]) || []
    const preset = presets.find(p => p.id === windowId)
    if (preset && Array.isArray(preset.languages)) return preset.languages
  } catch { /* ignore */ }
  return []
}

// Resolve the shared style for a target — from memory or the persisted preset.
function resolveStyleForTarget(windowId: string): any {
  const inMemory = windowStyles.get(windowId)
  if (inMemory) return inMemory
  try {
    const presets: any[] = (store.get('project-state') as any[]) || []
    const preset = presets.find(p => p.id === windowId)
    if (preset && preset.style) return preset.style
  } catch { /* ignore */ }
  return undefined
}

// Presets the user has toggled OFF — excluded from all broadcasting/translation so
// they don't burn STT/translation credits while unused.
const disabledPresets = new Set<string>()

// The set of broadcast targets: open Electron windows ∪ presets with OBS clients,
// minus any preset that's been disabled.
function broadcastTargetIds(): Set<string> {
  const ids = new Set<string>()
  for (const id of projectionWindows.keys()) {
    if (!disabledPresets.has(id)) ids.add(id)
  }
  for (const id of obsServer?.getSubscribedPresetIds() || []) {
    if (!disabledPresets.has(id)) ids.add(id)
  }
  return ids
}

// Helper to broadcast to all projection windows with per-layer translation support
async function broadcastToProjectionWindows(channel: string, data: any) {
  for (const windowId of broadcastTargetIds()) {
    const win = projectionWindows.get(windowId)
    if (win && win.isDestroyed()) continue

    const layers = resolveLayersForTarget(windowId)

    if (channel !== 'transcript-update') {
      // Non-transcript channels: send as-is (Electron window only)
      if (win && !win.isDestroyed()) win.webContents.send(channel, data)
      continue
    }

    // For each language layer in this window, handle translation separately
    for (const layer of layers) {
      const isTranslationLayer = layer.language !== 'live'

      // Translation layers: ONLY accept sentence-level events
      if (isTranslationLayer && !data.isSentence) continue

      if (isTranslationLayer && data.text && data.isSentence) {
        // Skip if source matches target
        const sourceLang = (data.detectedLanguage || '').split('-')[0]
        const targetLang = layer.language.split('-')[0]

        if (sourceLang && sourceLang === targetLang) {
          sendTranscript(win, windowId, { ...data, layerId: layer.id })
          continue
        }

        // Determine translation provider
        let translationProvider = 'GCP'
        try {
          const transSettings: any = store.get('transcription')
          if (transSettings?.translationProvider) {
            translationProvider = transSettings.translationProvider
          }
        } catch { /* default to GCP */ }

        console.log(`[Main] Window ${windowId} layer ${layer.id} (${layer.language}) translation needed. Provider: ${translationProvider}`)

        try {
          let translatedText: string | null = null

          if (translationProvider === 'GCP' && gcpTranslationService && gcpTranslationService.isReady()) {
            translatedText = await gcpTranslationService.translate(data.text, layer.language, data.detectedLanguage)
          } else if (translationProvider === 'RIVA' && rivaSpeechService) {
            translatedText = await rivaSpeechService.translate(data.text, layer.language, data.detectedLanguage)
          } else if (translationProvider === 'NLLB' && nllbTranslationService) {
            // translate() self-heals (lazy re-load) and falls back to the original text on failure
            translatedText = await nllbTranslationService.translate(data.text, layer.language, data.detectedLanguage)
          } else if (translationProvider === 'DEEPL' && deeplTranslationService && deeplTranslationService.isReady()) {
            translatedText = await deeplTranslationService.translate(data.text, layer.language, data.detectedLanguage)
          } else {
            console.warn(`[Main] Translation service ${translationProvider} not ready for layer ${layer.id}`)
          }

          if (translatedText !== null && translatedText.trim().length > 0) {
            console.log(`[${translationProvider}] Layer ${layer.id} translation: "${translatedText}"`)
            sendTranscript(win, windowId, { ...data, text: translatedText, layerId: layer.id })
          } else {
            // Translation failed or came back empty — fall back to the original text
            sendTranscript(win, windowId, { ...data, layerId: layer.id })
          }
        } catch (error) {
          console.error(`[${translationProvider}] Translation failed for layer ${layer.id}:`, error)
          sendTranscript(win, windowId, { ...data, layerId: layer.id })
        }
      } else if (!isTranslationLayer) {
        // Live layer: handled by broadcastLiveCaption, skip here for sentences
        // (sentences also sent to live layers for display)
        if (data.isSentence) {
          sendTranscript(win, windowId, { ...data, layerId: layer.id })
        }
      }
    }
  }
}

// Broadcast interim (live) transcripts — only to layers in 'live' mode
function broadcastLiveCaption(data: any) {
  for (const windowId of broadcastTargetIds()) {
    const win = projectionWindows.get(windowId)
    if (win && win.isDestroyed()) continue

    const layers = resolveLayersForTarget(windowId)
    for (const layer of layers) {
      if (layer.language === 'live') {
        sendTranscript(win, windowId, { ...data, layerId: layer.id })
      }
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
    windowStyles.delete(id)
    obsServer?.notifyWindowClosed(id)
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

app.on('before-quit', () => {
  obsServer?.stop()
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
  ensureBackgroundsDir()

  // Restore disabled-preset state from the persisted project so unused presets stay off
  try {
    const presets: any[] = (store.get('project-state') as any[]) || []
    for (const p of presets) {
      if (p && p.enabled === false) disabledPresets.add(p.id)
    }
  } catch { /* ignore */ }

  createTray()
  createMainWindow()

  // ── OBS Browser Source server (HTTP + WebSocket) ──────────────────────────
  let obsPort = 3456
  try {
    const obsSettings: any = store.get('obs')
    if (obsSettings && typeof obsSettings.port === 'number' && obsSettings.port > 0) {
      obsPort = obsSettings.port
    }
  } catch { /* default */ }

  obsServer = new ObsServer({
    port: obsPort,
    backgroundsDir,
    // Provide current config for a freshly-connected OBS client
    getConfig: (windowId: string) => {
      let cps = 17
      let queueMaxDepth = 0
      try {
        const s: any = store.get('transcription')
        if (typeof s?.subtitleCPS === 'number') cps = s.subtitleCPS
        if (typeof s?.subtitleQueueMaxDepth === 'number') queueMaxDepth = s.subtitleQueueMaxDepth
      } catch { /* defaults */ }

      // OBS can be used without opening the Electron projection window, so these
      // helpers fall back to the persisted preset when nothing is in memory.
      return {
        style: resolveStyleForTarget(windowId),
        layers: resolveLayersForTarget(windowId),
        cps,
        queueMaxDepth
      }
    }
  })
  obsServer.start().then((actualPort) => {
    console.log(`[Main] OBS server listening on http://localhost:${actualPort}`)
  }).catch((e) => {
    console.error('[Main] Failed to start OBS server:', e)
  })

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

  // ── Active STT provider ──────────────────────────────────────────────────
  // Only ONE provider receives audio at a time. User selects in Settings.
  let activeSTTProvider: string = 'GCP'
  try {
    const settings: any = store.get('transcription')
    activeSTTProvider = settings?.sttProvider || 'GCP'
  } catch { /* default to GCP */ }

  ipcMain.handle('set-active-stt-provider', async (_, provider: string) => {
    console.log(`[Main] Switching STT provider: ${activeSTTProvider} → ${provider}`)
    activeSTTProvider = provider
    resetSentenceBuffer()
    return true
  })

  // ── Shared sentence-assembly pipeline ─────────────────────────────────────
  // Providers that emit incremental finalized text (GCP / Sherpa / Riva / Whisper)
  // feed into a buffer here: their finals are accumulated, split into complete
  // sentences by the configured punctuation, and flushed as N-sentence blocks
  // (subtitleMaxSentences) — so continuous speech never piles up 4-5+ lines.
  // Deepgram is excluded: it already assembles N-sentence blocks in-service using
  // its own native endpointing (best quality), so its finals pass straight through.
  let sentenceSeq = 0

  // Sentence-boundary regex (one-or-more of the configured punctuation chars)
  function buildSentenceSplitRegex(chars: string[]): RegExp {
    if (!chars || chars.length === 0) return /[.!?…]+/g
    const escaped = chars.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('')
    return new RegExp(`[${escaped}]+`, 'g')
  }

  let splitChars: string[] = ['.', '!', '?', '…']
  try {
    const s: any = store.get('transcription')
    if (Array.isArray(s?.sentenceSplitChars) && s.sentenceSplitChars.length > 0) {
      splitChars = s.sentenceSplitChars
    }
  } catch { /* defaults */ }
  let sentenceSplitRe = buildSentenceSplitRegex(splitChars)

  ipcMain.on('update-sentence-split-chars', (_, chars: string[]) => {
    splitChars = chars
    sentenceSplitRe = buildSentenceSplitRegex(chars)
    console.log(`[Main] Sentence split chars updated: ${chars.join(' ')}`)
  })

  // Split text into complete sentences + a trailing incomplete remainder
  function splitIntoSentences(text: string): { sentences: string[]; remainder: string } {
    const sentences: string[] = []
    let start = 0
    sentenceSplitRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = sentenceSplitRe.exec(text)) !== null) {
      const end = m.index + m[0].length
      const s = text.slice(start, end).trim()
      if (s) sentences.push(s)
      start = end
    }
    const remainder = text.slice(start).trim()
    return { sentences, remainder }
  }

  function getMaxSentences(): number {
    try {
      const s: any = store.get('transcription')
      if (typeof s?.subtitleMaxSentences === 'number') return s.subtitleMaxSentences
    } catch { /* default */ }
    return 1
  }

  function emitSentence(text: string, lang: string, provider: string) {
    const seq = ++sentenceSeq
    console.log(`[Main] Sentence flush [seq=${seq}] (${provider}/${lang}): "${text.substring(0, 60)}"`)
    void broadcastToProjectionWindows('transcript-update', {
      provider, text, isFinal: true, isSentence: true, detectedLanguage: lang, seq
    })
  }

  // Unified buffer for non-Deepgram providers
  let finalBuffer = ''
  let finalBufferLang = ''
  let sentenceIdleTimer: ReturnType<typeof setTimeout> | null = null
  const SENTENCE_IDLE_FLUSH_MS = 1200   // flush the tail if no new final arrives (a pause)

  function flushSentenceRemainder(provider: string) {
    if (sentenceIdleTimer) { clearTimeout(sentenceIdleTimer); sentenceIdleTimer = null }
    const rem = finalBuffer.trim()
    if (rem) emitSentence(rem, finalBufferLang, provider)
    finalBuffer = ''
  }

  function feedFinalText(text: string, lang: string, provider: string) {
    finalBufferLang = lang
    finalBuffer = finalBuffer ? `${finalBuffer} ${text}` : text

    const maxSentences = Math.max(1, getMaxSentences())
    const { sentences, remainder } = splitIntoSentences(finalBuffer)

    // Flush every complete sentence immediately (grouped up to maxSentences) — never
    // wait for more; a finished sentence reaches the screen right away.
    while (sentences.length > 0) {
      const block = sentences.splice(0, maxSentences).join(' ')
      emitSentence(block, lang, provider)
    }

    finalBuffer = remainder

    if (sentenceIdleTimer) clearTimeout(sentenceIdleTimer)
    if (finalBuffer.trim()) {
      sentenceIdleTimer = setTimeout(() => flushSentenceRemainder(provider), SENTENCE_IDLE_FLUSH_MS)
    }
  }

  function resetSentenceBuffer() {
    if (sentenceIdleTimer) { clearTimeout(sentenceIdleTimer); sentenceIdleTimer = null }
    finalBuffer = ''
    finalBufferLang = ''
  }

  function handleTranscriptResult(result: any, provider: string) {
    const lang = result.detectedLanguage || result.language || ''

    // Interim → live captions only (no sentence assembly from non-final text)
    if (!result.isFinal) {
      broadcastLiveCaption({ ...result, provider, isSentence: false })
      return
    }

    const text = (result.text || '').trim()
    if (!text) return

    if (provider === 'DEEPGRAM') {
      // Deepgram already emits N-sentence blocks assembled in-service — pass through
      const seq = ++sentenceSeq
      console.log(`[Main] Deepgram block [seq=${seq}]: "${text.substring(0, 60)}"`)
      void broadcastToProjectionWindows('transcript-update', {
        ...result, provider, text, isSentence: true, seq
      })
      return
    }

    // All other providers: accumulate finals and flush N-sentence blocks
    feedFinalText(text, lang, provider)
  }

  // ── Initialize Silero VAD ─────────────────────────────────────────────────
  if (!sileroVad) {
    sileroVad = new SileroVadService()
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

    // ── Single audio router: VAD → active provider ──────────────────────────
    // This is the ONLY audio-for-stt listener. It routes to whichever provider
    // is currently selected, avoiding the duplicate-to-all-providers bug.
    sileroVad.on('audio-for-stt', (audioChunk: Buffer) => {
      switch (activeSTTProvider) {
        case 'GCP':
          if (gcpSpeechService) gcpSpeechService.writeAudio(audioChunk)
          break
        case 'SHERPA_ONNX':
          if (sherpaOnnxService) sherpaOnnxService.writeAudio(audioChunk)
          break
        case 'RIVA':
          if (rivaSpeechService) rivaSpeechService.writeAudio(audioChunk)
          break
        case 'DEEPGRAM':
          if (deepgramSpeechService) deepgramSpeechService.writeAudio(audioChunk)
          break
      }
    })
  }

  // ── Initialize GCP STT ────────────────────────────────────────────────────
  if (!gcpSpeechService) {
    gcpSpeechService = new GcpSpeechService()

    // Wire VAD as audio preprocessor for GCP
    if (sileroVad) {
      gcpSpeechService.audioPreprocessor = (chunk: Buffer) => {
        sileroVad!.processAudio(chunk)
      }
    }

    gcpSpeechService.on('transcript', (result) => {
      handleTranscriptResult(result, 'GCP')
    })
  }

  if (!gcpTranslationService) {
    gcpTranslationService = new GcpTranslationService()
    try {
      const settings: any = store.get('transcription')
      if (settings?.gcpKeyJson) {
        gcpTranslationService.initialize(settings.gcpKeyJson)
      }
    } catch (error) {
      console.log('No translation credentials found, translation will be disabled')
    }
  }

  if (!deeplTranslationService) {
    deeplTranslationService = new DeepLTranslationService()
    try {
      const settings: any = store.get('transcription')
      if (settings?.deeplApiKey) {
        deeplTranslationService.initialize(settings.deeplApiKey, settings.deeplApiUrl)
      }
    } catch {
      console.log('No DeepL key found, DeepL translation disabled')
    }
  }

  // ── Initialize Sherpa-ONNX STT ──────────────────────────────────────────
  if (!sherpaOnnxService) {
    sherpaOnnxService = new SherpaOnnxSpeechService()

    if (sileroVad) {
      sherpaOnnxService.audioPreprocessor = (chunk: Buffer) => {
        sileroVad!.processAudio(chunk)
      }
    }

    sherpaOnnxService.on('transcript', (result: any) => {
      handleTranscriptResult(result, 'SHERPA_ONNX')
    })

    sherpaOnnxService.on('error', (error) => {
      console.error('[Main] Sherpa-ONNX error:', error)
    })
  }

  // ── Initialize Riva STT + NMT ───────────────────────────────────────────
  if (!rivaSpeechService) {
    rivaSpeechService = new RivaSpeechService()

    if (sileroVad) {
      rivaSpeechService.audioPreprocessor = (chunk: Buffer) => {
        sileroVad!.processAudio(chunk)
      }
    }

    rivaSpeechService.on('transcript', (result: any) => {
      handleTranscriptResult(result, 'RIVA')
    })

    rivaSpeechService.on('error', (error) => {
      console.error('[Main] Riva error:', error)
    })
  }

  // ── Initialize Deepgram STT ─────────────────────────────────────────────
  if (!deepgramSpeechService) {
    deepgramSpeechService = new DeepgramSpeechService()

    if (sileroVad) {
      deepgramSpeechService.audioPreprocessor = (chunk: Buffer) => {
        sileroVad!.processAudio(chunk)
      }
    }

    deepgramSpeechService.on('transcript', (result: any) => {
      handleTranscriptResult(result, 'DEEPGRAM')
    })

    deepgramSpeechService.on('error', (error) => {
      console.error('[Main] Deepgram error:', error)
    })
  }

  // ── Initialize NLLB Translation ──────────────────────────────────────────
  if (!nllbTranslationService) {
    nllbTranslationService = new NllbTranslationService()

    // Initialize NLLB on demand via IPC
    ipcMain.handle('initialize-nllb', async (_, allowDownload: boolean = true) => {
      return nllbTranslationService?.initialize(allowDownload)
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
    // Keep style/layers cached for OBS overlay config, and push to OBS clients
    if (settings.style) windowStyles.set(id, settings.style)
    if (settings.languages) windowLanguageLayers.set(id, settings.languages)
    obsServer?.broadcastConfig(id, {
      style: windowStyles.get(id),
      layers: windowLanguageLayers.get(id) || [],
      title: settings.title
    })
  })

  ipcMain.handle('bring-to-front', (_, { id }) => {
    const win = projectionWindows.get(id)
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      win.moveTop()
    }
  })

  // ── Background image handlers ─────────────────────────────────────────────
  ipcMain.handle('select-background-image', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Background Image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null

    ensureBackgroundsDir()
    const srcPath = result.filePaths[0]
    const ext = path.extname(srcPath).toLowerCase() || '.png'
    const filename = `${crypto.randomUUID()}${ext}`
    const destPath = path.join(backgroundsDir, filename)
    try {
      await fs.promises.copyFile(srcPath, destPath)
      return filename
    } catch (e) {
      console.error('[Main] Failed to copy background image:', e)
      return null
    }
  })

  // Return an HTTP URL (served by the OBS server) for a stored background filename.
  // Using http rather than file:// so it loads in the Dashboard preview and the
  // projection window regardless of their origin / webSecurity (dev vs packaged).
  ipcMain.handle('get-background-image-path', (_, filename: string) => {
    if (!filename) return null
    const full = path.join(backgroundsDir, filename)
    if (!fs.existsSync(full)) return null
    const port = obsServer?.getPort() ?? 3456
    return `http://localhost:${port}/backgrounds/${encodeURIComponent(filename)}`
  })

  // Push a preset's current style/layers to connected OBS clients, even when no
  // Electron projection window is open (Dashboard calls this on every edit).
  ipcMain.handle('push-obs-config', (_, { id, style, languages }: { id: string, style?: any, languages?: any[] }) => {
    obsServer?.broadcastConfig(id, { style, layers: languages || [] })
  })

  // Enable/disable a preset. Disabled presets are excluded from all broadcasting and
  // translation so they don't consume STT/translation credits while unused.
  ipcMain.handle('set-preset-enabled', (_, { id, enabled }: { id: string, enabled: boolean }) => {
    if (enabled) disabledPresets.delete(id)
    else disabledPresets.add(id)
    console.log(`[Main] Preset ${id} ${enabled ? 'enabled' : 'disabled'}`)
  })

  // ── Preset export / import ────────────────────────────────────────────────
  ipcMain.handle('export-presets', async (_, presets: any) => {
    const result = await dialog.showSaveDialog({
      title: 'Export Presets',
      defaultPath: 'dilmesh-presets.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    try {
      await fs.promises.writeFile(result.filePath, JSON.stringify(presets, null, 2), 'utf-8')
      return { ok: true, path: result.filePath }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Write failed' }
    }
  })

  ipcMain.handle('import-presets', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Presets',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false }
    try {
      const raw = await fs.promises.readFile(result.filePaths[0], 'utf-8')
      const data = JSON.parse(raw)
      const presets = Array.isArray(data) ? data : (data?.presets || [])
      return { ok: true, presets }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Invalid JSON file' }
    }
  })

  // ── OBS overlay URL ───────────────────────────────────────────────────────
  ipcMain.handle('get-obs-url', (_, { presetId }: { presetId: string }) => {
    const port = obsServer?.getPort() ?? 3456
    return `http://localhost:${port}/obs/${presetId}`
  })

  // Get the active OBS server port (for Settings display)
  ipcMain.handle('get-obs-port', () => obsServer?.getPort() ?? 3456)

  // Change the OBS server port (persists to store + restarts server)
  ipcMain.handle('set-obs-port', async (_, port: number) => {
    if (!port || port < 1 || port > 65535) return { ok: false, error: 'Invalid port' }
    try {
      store.set('obs', { ...(store.get('obs') as any || {}), port })
    } catch { /* ignore */ }
    if (obsServer) {
      const actual = await obsServer.restart(port)
      return { ok: true, port: actual }
    }
    return { ok: false, error: 'Server not running' }
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
            windowLanguageLayers.delete(id) // Clean up language layers
          }
        }
      ])
      contextMenu.popup({ window: win })
    })
  })

  // Handler to set window language layers (multi-language)
  ipcMain.handle('set-window-languages', (_, { windowId, languages }) => {
    windowLanguageLayers.set(windowId, languages)
    console.log(`Window ${windowId} languages set: ${languages.map((l: LanguageLayer) => l.language).join(', ')}`)
    // Notify the window itself so Projection.vue can update its layers
    const win = projectionWindows.get(windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('languages-updated', { languages })
    }
    // Push to OBS overlay clients
    obsServer?.broadcastConfig(windowId, {
      style: windowStyles.get(windowId),
      layers: languages
    })
  })

  // Handler to get window language layers
  ipcMain.handle('get-window-languages', (_, { windowId }) => {
    return windowLanguageLayers.get(windowId) || []
  })

  // Legacy handler for backward compatibility
  ipcMain.handle('set-window-language', (_, { windowId, language }) => {
    // Convert single language to a single-layer array
    const layer: LanguageLayer = {
      id: 'legacy-' + windowId,
      language: language,
      positionX: 50,
      positionY: 50,
      fontSize: 48,
      fontFamily: 'Arial',
      textColor: '#FFFFFF',
      maxLines: 4,
      maxWidth: 0
    }
    windowLanguageLayers.set(windowId, [layer])
    console.log(`Window ${windowId} language set (legacy): ${language}`)
    const win = projectionWindows.get(windowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send('languages-updated', { languages: [layer] })
    }
  })

  // Legacy handler
  ipcMain.handle('get-window-language', (_, { windowId }) => {
    const layers = windowLanguageLayers.get(windowId) || []
    return layers.length > 0 ? layers[0].language : 'live'
  })

  // Handler to update GCP credentials dynamically
  ipcMain.handle('update-gcp-credentials', (_, keyJson) => {
    if (gcpTranslationService) {
      console.log('Updating GCP credentials for Translation Service...')
      return gcpTranslationService.initialize(keyJson)
    }
    return false
  })

  // Handler to update DeepL API key dynamically
  ipcMain.handle('update-deepl-key', (_, { apiKey, apiUrl }: { apiKey: string, apiUrl?: string }) => {
    if (!deeplTranslationService) deeplTranslationService = new DeepLTranslationService()
    console.log('Updating DeepL API key for Translation Service...')
    return deeplTranslationService.initialize(apiKey, apiUrl)
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

