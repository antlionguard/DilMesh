import { ipcMain } from 'electron'
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'
import { EventEmitter } from 'events'

interface DeepgramConfig {
    deepgramApiKey?: string
    deepgramModel?: string
    deepgramLanguage?: string
    languages?: string[]
    deepgramPunctuate?: boolean
    deepgramDiarize?: boolean
    deepgramUtterances?: boolean
    deepgramInterimResults?: boolean
    deepgramEndpointing?: number | false
    deepgramSmartFormat?: boolean
    deepgramProfanityFilter?: boolean
    deepgramUtteranceEndMs?: number
    deepgramEncoding?: string
    deepgramSampleRate?: number
    deepgramFillerWords?: boolean
    deepgramKeywords?: string
}

interface LanguageStream {
    connection: any
    language: string
    reconnectTimer: NodeJS.Timeout | null
    keepAliveTimer: NodeJS.Timeout | null
    sentenceBuffer: string[]
    lastConfidence: number
    consecutiveFailures: number
    restartScheduled: boolean
}

export class DeepgramSpeechService extends EventEmitter {
    private languageStreams: Map<string, LanguageStream> = new Map()
    private isRunning: boolean = false
    private apiKey: string = ''

    public audioPreprocessor: ((chunk: Buffer) => void) | null = null

    private currentConfig: DeepgramConfig = {}
    private currentLanguages: string[] = ['en']

    // Cross-stream sentence comparison
    // When speech_final arrives on one stream, wait briefly for the other streams
    private sentenceDebounceTimer: NodeJS.Timeout | null = null
    private pendingSentences: Map<string, { text: string; confidence: number }> = new Map()

    // Dominant language stickiness
    private dominantLanguage: string | null = null
    private lastResultTime: number = 0
    private static readonly SILENCE_RESET_MS = 3000
    private static readonly DOMINANT_BIAS = 0.3

    private static readonly LANGUAGE_MAP: Record<string, string> = {
        'auto': 'multi',
        'en': 'en',
        'tr': 'tr',
        'en-US': 'en-US',
        'tr-TR': 'tr',
    }

    constructor() {
        super()
        this.setupHandlers()
    }

    setupHandlers() {
        ipcMain.handle('start-deepgram-transcription', async (_, config) => {
            return this.start(config)
        })

        ipcMain.handle('stop-deepgram-transcription', async () => {
            return this.stop()
        })

        ipcMain.on('deepgram-audio-chunk', (_, audioData: ArrayBuffer) => {
            const buffer = Buffer.from(audioData)
            if (this.audioPreprocessor) {
                this.audioPreprocessor(buffer)
            } else {
                this.writeAudio(buffer)
            }
        })
    }

    async start(config: DeepgramConfig): Promise<boolean> {
        try {
            this.currentConfig = config
            this.apiKey = config.deepgramApiKey || ''

            if (!this.apiKey) {
                console.error('[Deepgram] No API key provided')
                this.emit('error', new Error('Deepgram API key is required'))
                return false
            }

            // Resolve languages
            if (config.languages && config.languages.length > 0) {
                this.currentLanguages = config.languages.map(
                    lang => DeepgramSpeechService.LANGUAGE_MAP[lang] || lang
                )
            } else {
                const lang = config.deepgramLanguage || 'multi'
                this.currentLanguages = [DeepgramSpeechService.LANGUAGE_MAP[lang] || lang]
            }
            this.currentLanguages = [...new Set(this.currentLanguages)]

            console.log(`[Deepgram] Starting parallel streams: ${this.currentLanguages.join(', ')}`)

            this.isRunning = true

            for (const language of this.currentLanguages) {
                await this.createStreamForLanguage(language)
            }

            console.log(`[Deepgram] ${this.currentLanguages.length} parallel stream(s) active`)
            return true
        } catch (error) {
            console.error('[Deepgram] Failed to start:', error)
            this.emit('error', error instanceof Error ? error : new Error(String(error)))
            return false
        }
    }

    private async createStreamForLanguage(language: string): Promise<void> {
        const config = this.currentConfig

        const options: Record<string, any> = {
            model: config.deepgramModel || 'nova-3',
            language: language,
            punctuate: config.deepgramPunctuate ?? true,
            diarize: config.deepgramDiarize ?? false,
            // interim_results needed so we get is_final markers within continuous speech
            interim_results: config.deepgramInterimResults ?? true,
            smart_format: config.deepgramSmartFormat ?? true,
            profanity_filter: config.deepgramProfanityFilter ?? false,
            filler_words: config.deepgramFillerWords ?? false,
            encoding: config.deepgramEncoding || 'linear16',
            sample_rate: config.deepgramSampleRate || 16000,
            channels: 1,
            // utterances for sentence-level segmentation
            utterances: config.deepgramUtterances ?? true,
        }

        // Endpointing
        const endpointing = config.deepgramEndpointing
        if (endpointing === false || endpointing === 0) {
            options.endpointing = false
        } else {
            options.endpointing = endpointing ?? 300
        }

        // Utterance end timeout
        if (config.deepgramUtteranceEndMs && config.deepgramUtteranceEndMs > 0) {
            options.utterance_end_ms = config.deepgramUtteranceEndMs
        }

        // Keywords boosting (Nova-2 only — Nova-3 returns 400 if keywords are sent)
        const model = config.deepgramModel || 'nova-3'
        if (model.startsWith('nova-2') && config.deepgramKeywords && config.deepgramKeywords.trim()) {
            options.keywords = config.deepgramKeywords
                .split(',')
                .map((k: string) => k.trim())
                .filter((k: string) => k.length > 0)
        }

        console.log(`[Deepgram] Creating stream: ${language}`, JSON.stringify(options, null, 2))

        const deepgram = createClient(this.apiKey)
        const connection = deepgram.listen.live(options)

        connection.on(LiveTranscriptionEvents.Open, () => {
            console.log(`[Deepgram] ✅ Stream opened: ${language}`)
        })

        connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
            this.handleTranscript(language, data)
        })

        // UtteranceEnd = Deepgram detected a complete utterance boundary
        connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
            this.handleUtteranceEnd(language)
        })

        connection.on(LiveTranscriptionEvents.Error, (error: any) => {
            const errMsg = error?.message || String(error)
            console.error(`[Deepgram] Stream error (${language}):`, errMsg)

            // Don't retry on 400 (bad config) — it will never succeed
            if (errMsg.includes('400')) {
                console.error(`[Deepgram] ❌ 400 Bad Request for ${language} — NOT retrying (check config)`)
                return
            }

            this.scheduleRestart(language)
        })

        connection.on(LiveTranscriptionEvents.Close, () => {
            console.log(`[Deepgram] Stream closed: ${language}`)
            // Only restart if Error handler hasn't already scheduled one
            const entry = this.languageStreams.get(language)
            if (entry && !entry.restartScheduled) {
                this.scheduleRestart(language)
            }
        })

        // Keep-alive every 8s
        const keepAliveTimer = setInterval(() => {
            try { connection.keepAlive() } catch { /* ignore */ }
        }, 8000)

        this.languageStreams.set(language, {
            connection,
            language,
            reconnectTimer: null,
            keepAliveTimer,
            sentenceBuffer: [],
            lastConfidence: 0,
            consecutiveFailures: 0,
            restartScheduled: false,
        })
    }

    /**
     * Deepgram transcript handler.
     * 
     * Strategy (from Deepgram docs):
     * - is_final: false → interim result, we SKIP these (no flooding)
     * - is_final: true  → finalized segment, APPEND to sentence buffer
     * - speech_final: true → endpointing detected pause, FLUSH sentence buffer
     */
    private handleTranscript(language: string, data: any): void {
        const channel = data.channel
        if (!channel?.alternatives?.length) return

        const alt = channel.alternatives[0]
        const text = (alt.transcript || '').trim()
        const confidence = alt.confidence || 0
        const isFinal = data.is_final || false
        const speechFinal = data.speech_final || false

        if (!text) return

        const stream = this.languageStreams.get(language)
        if (!stream) return

        if (!isFinal) {
            // Interim result — skip (no flooding)
            return
        }

        // is_final: true → append to sentence buffer
        stream.sentenceBuffer.push(text)
        stream.lastConfidence = confidence

        console.log(
            `[Deepgram] ${language}: segment "${text}" ` +
            `(conf: ${confidence.toFixed(3)}, speech_final: ${speechFinal}, buffer: ${stream.sentenceBuffer.length} parts)`
        )

        // speech_final: true → speaker paused, flush the buffer as a complete sentence
        if (speechFinal) {
            this.flushSentenceBuffer(language)
        }
    }

    /**
     * UtteranceEnd event = Deepgram confirms the utterance is complete.
     * Flush any remaining buffered segments.
     */
    private handleUtteranceEnd(language: string): void {
        const stream = this.languageStreams.get(language)
        if (!stream || stream.sentenceBuffer.length === 0) return

        console.log(`[Deepgram] UtteranceEnd for ${language} — flushing buffer`)
        this.flushSentenceBuffer(language)
    }

    /**
     * Flush one language's sentence buffer into the cross-stream comparison.
     */
    private flushSentenceBuffer(language: string): void {
        const stream = this.languageStreams.get(language)
        if (!stream || stream.sentenceBuffer.length === 0) return

        const fullSentence = stream.sentenceBuffer.join(' ')
        const confidence = stream.lastConfidence

        // Clear buffer
        stream.sentenceBuffer = []
        stream.lastConfidence = 0

        console.log(`[Deepgram] 📝 ${language} sentence: "${fullSentence}" (conf: ${confidence.toFixed(3)})`)

        // Add to pending sentences for cross-stream comparison
        this.pendingSentences.set(language, { text: fullSentence, confidence })

        // Debounce: wait 200ms for other streams to also flush
        if (this.sentenceDebounceTimer) {
            clearTimeout(this.sentenceDebounceTimer)
        }
        this.sentenceDebounceTimer = setTimeout(() => {
            this.emitBestSentence()
        }, 200)
    }

    /**
     * Compare pending sentences across parallel streams.
     * Pick the one with the highest (biased) confidence.
     */
    private emitBestSentence(): void {
        if (this.pendingSentences.size === 0) return

        const now = Date.now()

        // Reset dominant language after silence
        if (now - this.lastResultTime > DeepgramSpeechService.SILENCE_RESET_MS) {
            this.dominantLanguage = null
        }

        let bestLang = ''
        let bestText = ''
        let bestScore = -1

        for (const [lang, sentence] of this.pendingSentences.entries()) {
            let score = sentence.confidence
            if (score === 0) {
                // Fallback: use text length as weak signal
                score = Math.min(sentence.text.length * 0.002, 0.15)
            }
            // Bias toward dominant language
            if (this.dominantLanguage && lang === this.dominantLanguage) {
                score += DeepgramSpeechService.DOMINANT_BIAS
            }
            if (score > bestScore) {
                bestScore = score
                bestLang = lang
                bestText = sentence.text
            }
        }

        if (bestText) {
            // Suppress non-dominant if low confidence
            if (this.dominantLanguage && bestLang !== this.dominantLanguage && bestScore < 0.5) {
                console.log(`[Deepgram] 🛡️ Suppressed ${bestLang} (score: ${bestScore.toFixed(3)}) — dominant: ${this.dominantLanguage}`)
                this.pendingSentences.clear()
                return
            }

            // Update dominant language
            if (this.dominantLanguage && bestLang !== this.dominantLanguage) {
                console.log(`[Deepgram] 🔄 Language switch: ${this.dominantLanguage} → ${bestLang}`)
            }
            this.dominantLanguage = bestLang
            this.lastResultTime = now

            console.log(`[Deepgram] ✅ WINNER: ${bestLang} — "${bestText.substring(0, 60)}..." (score: ${bestScore.toFixed(3)})`)

            this.emit('transcript', {
                provider: 'DEEPGRAM',
                text: bestText,
                isFinal: true,
                confidence: bestScore,
                detectedLanguage: bestLang,
            })
        }

        this.pendingSentences.clear()
    }

    // Fan out audio to ALL active language streams
    writeAudio(audioChunk: Buffer): void {
        if (!this.isRunning) return

        for (const [, entry] of this.languageStreams.entries()) {
            if (entry.connection) {
                try {
                    entry.connection.send(audioChunk)
                } catch { /* stream will auto-restart */ }
            }
        }
    }

    private static readonly MAX_CONSECUTIVE_FAILURES = 3

    private scheduleRestart(language: string): void {
        if (!this.isRunning) return

        const entry = this.languageStreams.get(language)
        if (!entry) return

        // Prevent double-scheduling from Error+Close
        if (entry.restartScheduled) return
        entry.restartScheduled = true

        // Track consecutive failures
        entry.consecutiveFailures++

        if (entry.consecutiveFailures > DeepgramSpeechService.MAX_CONSECUTIVE_FAILURES) {
            console.error(`[Deepgram] ❌ ${language} failed ${entry.consecutiveFailures} times — giving up. Check settings and restart manually.`)
            return
        }

        if (entry.reconnectTimer) {
            clearTimeout(entry.reconnectTimer)
        }

        // Exponential backoff: 500ms, 1s, 2s
        const delay = Math.min(500 * Math.pow(2, entry.consecutiveFailures - 1), 5000)
        console.log(`[Deepgram] Will restart ${language} in ${delay}ms (attempt ${entry.consecutiveFailures}/${DeepgramSpeechService.MAX_CONSECUTIVE_FAILURES})`)

        entry.reconnectTimer = setTimeout(async () => {
            if (!this.isRunning) return

            console.log(`[Deepgram] Restarting stream: ${language}...`)
            try {
                const old = this.languageStreams.get(language)
                if (old?.keepAliveTimer) clearInterval(old.keepAliveTimer)
                if (old?.connection) {
                    try { old.connection.requestClose() } catch { /* ignore */ }
                }
                this.languageStreams.delete(language)
                await this.createStreamForLanguage(language)
                // Reset failure count on successful reconnect
                const newEntry = this.languageStreams.get(language)
                if (newEntry) newEntry.consecutiveFailures = 0
            } catch (error) {
                console.error(`[Deepgram] Restart failed (${language}):`, error)
                this.scheduleRestart(language)
            }
        }, delay)
    }

    async stop(): Promise<void> {
        this.isRunning = false

        if (this.sentenceDebounceTimer) {
            clearTimeout(this.sentenceDebounceTimer)
            this.sentenceDebounceTimer = null
        }
        this.pendingSentences.clear()

        for (const [language, entry] of this.languageStreams.entries()) {
            if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
            if (entry.keepAliveTimer) clearInterval(entry.keepAliveTimer)
            if (entry.connection) {
                try { entry.connection.requestClose() } catch { /* ignore */ }
            }
            console.log(`[Deepgram] Stream stopped: ${language}`)
        }
        this.languageStreams.clear()
        this.dominantLanguage = null

        console.log('[Deepgram] All streams stopped')
    }

    running(): boolean {
        return this.isRunning
    }
}
