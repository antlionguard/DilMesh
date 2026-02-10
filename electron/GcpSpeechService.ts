import { ipcMain } from 'electron'
import { SpeechClient, protos } from '@google-cloud/speech'
import { EventEmitter } from 'events'

type IRecognitionConfig = protos.google.cloud.speech.v1.IRecognitionConfig

interface LanguageResult {
    text: string
    confidence: number
    isFinal: boolean
    language: string
    timestamp: number
}

interface LanguageStream {
    stream: any
    language: string
    restartTimeout: NodeJS.Timeout | null
}

export class GcpSpeechService extends EventEmitter {
    private client: SpeechClient | null = null
    private languageStreams: Map<string, LanguageStream> = new Map()
    private isRunning: boolean = false

    // Store config for auto-restart
    private currentGcpKeyJson: string = ''
    private currentLanguages: string[] = ['en-US']
    private currentModel: string = 'latest_long'
    private currentEncoding: string = 'LINEAR16'
    private currentInterimResults: boolean = true
    private currentAutoPunctuation: boolean = true
    private currentUseEnhanced: boolean = false
    private currentSingleUtterance: boolean = false
    private currentMaxAlternatives: number = 1
    private currentConfidenceThreshold: number = 0.85
    private currentMinWordBuffer: number = 3

    // Interim result debouncing
    private interimDebounceTimer: NodeJS.Timeout | null = null
    private pendingInterimResults: Map<string, LanguageResult> = new Map()

    // Language code mapping
    private static readonly LANGUAGE_MAP: Record<string, string> = {
        'auto': 'en-US',
        'en': 'en-US',
        'tr': 'tr-TR',
        'en-US': 'en-US',
        'tr-TR': 'tr-TR'
    }

    constructor() {
        super()
        this.setupHandlers()
    }

    setupHandlers() {
        ipcMain.handle('start-gcp-transcription', async (_, config) => {
            return this.start(config)
        })

        ipcMain.handle('stop-gcp-transcription', async () => {
            return this.stop()
        })

        // Handler for receiving audio chunks from renderer
        ipcMain.on('gcp-audio-chunk', (_, audioData: ArrayBuffer) => {
            this.writeAudio(Buffer.from(audioData))
        })
    }

    async start(config: {
        gcpKeyJson?: string,
        language?: string,          // backward compat: single language
        languages?: string[],       // new: array of languages
        gcpModel?: string,
        gcpEncoding?: string,
        gcpInterimResults?: boolean,
        gcpAutoPunctuation?: boolean,
        gcpUseEnhanced?: boolean,
        gcpSingleUtterance?: boolean,
        gcpMaxAlternatives?: number,
        gcpConfidenceThreshold?: number,
        gcpMinWordBuffer?: number
    }): Promise<boolean> {
        try {
            // Store config
            this.currentGcpKeyJson = config.gcpKeyJson || ''
            this.currentModel = config.gcpModel || 'latest_long'
            this.currentEncoding = config.gcpEncoding || 'LINEAR16'
            this.currentInterimResults = config.gcpInterimResults ?? true
            this.currentAutoPunctuation = config.gcpAutoPunctuation ?? true
            this.currentUseEnhanced = config.gcpUseEnhanced ?? false
            this.currentSingleUtterance = config.gcpSingleUtterance ?? false
            this.currentMaxAlternatives = config.gcpMaxAlternatives ?? 1
            this.currentConfidenceThreshold = config.gcpConfidenceThreshold ?? 0.85
            this.currentMinWordBuffer = config.gcpMinWordBuffer ?? 3

            // Resolve languages: prefer array, fall back to single language
            if (config.languages && config.languages.length > 0) {
                this.currentLanguages = config.languages.map(
                    lang => GcpSpeechService.LANGUAGE_MAP[lang] || lang
                )
            } else {
                const lang = config.language || 'en-US'
                this.currentLanguages = [GcpSpeechService.LANGUAGE_MAP[lang] || lang]
            }

            // Deduplicate
            this.currentLanguages = [...new Set(this.currentLanguages)]

            console.log(`[GCP Parallel] Starting with languages: ${this.currentLanguages.join(', ')}`)

            // Initialize client (shared across all streams)
            if (!this.client) {
                if (this.currentGcpKeyJson) {
                    const credentials = JSON.parse(this.currentGcpKeyJson)
                    this.client = new SpeechClient({ credentials })
                } else {
                    this.client = new SpeechClient()
                }
            }

            this.isRunning = true

            // Create a stream for each language
            for (const language of this.currentLanguages) {
                await this.createStreamForLanguage(language)
            }

            console.log(`[GCP Parallel] ${this.currentLanguages.length} parallel recognizer(s) started`)
            return true
        } catch (error) {
            console.error('[GCP Parallel] Failed to start:', error)
            return false
        }
    }

    private async createStreamForLanguage(language: string): Promise<void> {
        const recognitionConfig: IRecognitionConfig = {
            encoding: this.currentEncoding as any,
            sampleRateHertz: 16000,
            languageCode: language,
            enableAutomaticPunctuation: this.currentAutoPunctuation,
            model: this.currentModel,
            useEnhanced: this.currentUseEnhanced,
            maxAlternatives: this.currentMaxAlternatives
        }

        const streamingRequest = {
            config: recognitionConfig,
            interimResults: this.currentInterimResults,
            singleUtterance: this.currentSingleUtterance
        }

        const stream = this.client!
            ._streamingRecognize()
            .on('data', (response: protos.google.cloud.speech.v1.IStreamingRecognizeResponse) => {
                this.handleStreamResult(language, response)
            })
            .on('error', (error: Error) => {
                console.log(`[GCP Parallel] Stream error for ${language}, will auto-restart:`, error.message)
                this.scheduleRestart(language)
            })
            .on('end', () => {
                console.log(`[GCP Parallel] Stream ended for ${language}`)
                this.scheduleRestart(language)
            })

        // Send streaming config first
        stream.write({ streamingConfig: streamingRequest })

        // Store the stream
        this.languageStreams.set(language, {
            stream,
            language,
            restartTimeout: null
        })

        console.log(`[GCP Parallel] Stream created for: ${language}`)
    }

    private handleStreamResult(
        language: string,
        response: protos.google.cloud.speech.v1.IStreamingRecognizeResponse
    ): void {
        if (!response.results || response.results.length === 0) return

        const result = response.results[0]
        if (!result.alternatives || result.alternatives.length === 0) return

        // Find the best alternative based on confidence
        // If maxAlternatives > 1, we want to pick the one with the highest confidence
        let bestAlt = result.alternatives[0]
        if (result.alternatives.length > 1) {
            for (const alt of result.alternatives) {
                if ((alt.confidence || 0) > (bestAlt.confidence || 0)) {
                    bestAlt = alt
                }
            }
        }

        const text = bestAlt.transcript || ''
        const confidence = bestAlt.confidence || 0
        const isFinal = result.isFinal || false

        if (!text.trim()) return

        console.log(`[GCP Parallel] ${language}: "${text.substring(0, 50)}..." (confidence: ${confidence.toFixed(3)}, final: ${isFinal})`)

        if (isFinal) {
            // For final results, emit immediately — only the highest confidence wins
            this.handleFinalResult({ text, confidence, isFinal, language, timestamp: Date.now() })
        } else {
            // For interim results, debounce to collect from all streams
            this.pendingInterimResults.set(language, {
                text, confidence, isFinal, language, timestamp: Date.now()
            })
            this.scheduleInterimEmit()
        }
    }

    // Language stickiness state
    private dominantLanguage: string | null = null
    private lastResultTime: number = 0
    private static readonly SILENCE_RESET_MS = 3000 // Reset dominant language after 3s silence
    private static readonly DOMINANT_BIAS = 0.3 // Bonus confidence for dominant language in interim selection

    private handleFinalResult(result: LanguageResult): void {
        const now = Date.now()

        // Check for silence reset
        if (now - this.lastResultTime > GcpSpeechService.SILENCE_RESET_MS) {
            console.log(`[GCP Parallel] Silence detected (> ${GcpSpeechService.SILENCE_RESET_MS}ms), resetting dominant language`)
            this.dominantLanguage = null
        }

        // Apply strict filtering based on dominant language
        if (this.dominantLanguage && result.language !== this.dominantLanguage) {
            // If another language tries to emit a final result while we are locked to a dominant language,
            // we enforce a high confidence threshold to allow a switch.
            // This filters out "Germany recorded" type hallucinations from the unused recognizer.
            if (result.confidence < 0.9) {
                console.log(`[GCP Parallel] 🛡️ Suppressed ${result.language} final result (conf: ${result.confidence.toFixed(3)}) due to active dominant language: ${this.dominantLanguage}`)
                return
            }
            console.log(`[GCP Parallel] 🔄 Language switch detected! ${this.dominantLanguage} -> ${result.language} (conf: ${result.confidence.toFixed(3)})`)
        }

        // Apply user-defined confidence threshold filtering
        if (result.confidence > 0 && result.confidence < this.currentConfidenceThreshold) {
            console.log(`[GCP Parallel] 📉 Suppressed ${result.language} final result (conf: ${result.confidence.toFixed(3)}) below threshold: ${this.currentConfidenceThreshold}`)
            return
        }

        // Clear interim debounce since we have a final result
        if (this.interimDebounceTimer) {
            clearTimeout(this.interimDebounceTimer)
            this.interimDebounceTimer = null
        }
        this.pendingInterimResults.clear()

        // Update state
        this.dominantLanguage = result.language
        this.lastResultTime = now

        console.log(`[GCP Parallel] ✅ FINAL winner: ${result.language} (confidence: ${result.confidence.toFixed(3)})`)

        this.emit('transcript', {
            provider: 'GCP',
            text: result.text,
            isFinal: true,
            confidence: result.confidence,
            detectedLanguage: result.language
        })
    }

    private scheduleInterimEmit(): void {
        if (this.interimDebounceTimer) {
            clearTimeout(this.interimDebounceTimer)
        }

        // Wait 150ms to collect interim results from all streams
        this.interimDebounceTimer = setTimeout(() => {
            this.emitBestInterim()
        }, 150)
    }

    private emitBestInterim(): void {
        if (this.pendingInterimResults.size === 0) return

        const now = Date.now()

        // Check for silence reset (also applies to interim streams)
        if (now - this.lastResultTime > GcpSpeechService.SILENCE_RESET_MS) {
            this.dominantLanguage = null
        }

        // Pick the result with the highest WEIGHTED confidence
        let best: LanguageResult | null = null
        let bestScore = -1

        for (const result of this.pendingInterimResults.values()) {
            let score = result.confidence

            // Handle 0 confidence (common in interim) by using length heuristic as a small base score
            if (score === 0) {
                score = Math.min(result.text.length * 0.001, 0.1) // Cap heuristic contribution
            }

            // Apply bias if matches dominant language
            if (this.dominantLanguage && result.language === this.dominantLanguage) {
                score += GcpSpeechService.DOMINANT_BIAS
            }

            if (score > bestScore) {
                bestScore = score
                best = result
            }
        }

        if (best) {
            // Apply threshold filter even for interim results
            // If best.confidence is real (>0) and below threshold, skip
            if (best.confidence > 0 && best.confidence < this.currentConfidenceThreshold) {
                // console.log(`[GCP Parallel] Suppressed interim (conf: ${best.confidence.toFixed(3)}) below threshold`)
                this.pendingInterimResults.clear()
                return
            }

            // Apply word buffer filter for interim results
            // Count words in the text (split by whitespace)
            const wordCount = best.text.trim().split(/\s+/).filter(w => w.length > 0).length

            if (this.currentMinWordBuffer > 0 && wordCount < this.currentMinWordBuffer) {
                // console.log(`[GCP Parallel] Buffering interim (${wordCount} words < ${this.currentMinWordBuffer} minimum)`)
                this.pendingInterimResults.clear()
                return
            }

            // Update state (keep locking to this language if it keeps winning)
            // Only update active language if we have some reasonable confidence or it's already set
            if (bestScore > 0.2 || this.dominantLanguage) {
                this.dominantLanguage = best.language
                this.lastResultTime = now
            }

            this.emit('transcript', {
                provider: 'GCP',
                text: best.text,
                isFinal: false,
                confidence: best.confidence,
                detectedLanguage: best.language
            })
        }

        this.pendingInterimResults.clear()
    }

    private scheduleRestart(language: string): void {
        if (!this.isRunning) return

        const entry = this.languageStreams.get(language)
        if (entry?.restartTimeout) {
            clearTimeout(entry.restartTimeout)
        }

        const timeout = setTimeout(async () => {
            if (this.isRunning) {
                console.log(`[GCP Parallel] Auto-restarting stream for ${language}...`)
                try {
                    await this.createStreamForLanguage(language)
                    console.log(`[GCP Parallel] Stream restarted for ${language}`)
                } catch (error) {
                    console.error(`[GCP Parallel] Failed to restart stream for ${language}:`, error)
                    this.scheduleRestart(language)
                }
            }
        }, 100)

        if (entry) {
            entry.restartTimeout = timeout
        }
    }

    // Fan out audio to ALL active language streams
    writeAudio(audioChunk: Buffer) {
        if (!this.isRunning) return

        for (const [language, entry] of this.languageStreams.entries()) {
            if (entry.stream) {
                try {
                    entry.stream.write({ audioContent: audioChunk })
                } catch (error) {
                    console.log(`[GCP Parallel] Write error for ${language}, stream will restart`)
                }
            }
        }
    }

    async stop(): Promise<void> {
        this.isRunning = false

        // Clear interim debounce
        if (this.interimDebounceTimer) {
            clearTimeout(this.interimDebounceTimer)
            this.interimDebounceTimer = null
        }
        this.pendingInterimResults.clear()

        // Stop all language streams
        for (const [language, entry] of this.languageStreams.entries()) {
            if (entry.restartTimeout) {
                clearTimeout(entry.restartTimeout)
            }
            if (entry.stream) {
                try {
                    entry.stream.end()
                } catch (e) {
                    // Ignore end errors
                }
            }
            console.log(`[GCP Parallel] Stream stopped for ${language}`)
        }
        this.languageStreams.clear()

        if (this.client) {
            await this.client.close()
            this.client = null
        }
        console.log('[GCP Parallel] All streams stopped')
    }
}
