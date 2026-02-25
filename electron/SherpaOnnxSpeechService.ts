import { EventEmitter } from 'events'
import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

export interface SherpaOnnxConfig {
    modelDir: string        // Path to the sherpa-onnx model directory
    modelType?: string      // 'transducer' | 'paraformer' | 'nemoCtc'
    sampleRate?: number     // Default 16000
    language?: string       // Language code for result metadata
}

/**
 * SherpaOnnxSpeechService provides ASR using sherpa-onnx.
 *
 * Supports both:
 *   - Online (streaming) models: Zipformer transducer, Paraformer
 *   - Offline models: NeMo CTC, Omnilingual CTC
 *
 * For offline models, audio is accumulated in a buffer and decoded
 * periodically (every ~2 seconds of audio) to provide interim results.
 * Final results are emitted when silence is detected or stop() is called.
 *
 * Same EventEmitter interface as GcpSpeechService:
 *   emit('transcript', { text, isFinal, language, provider, confidence })
 */
export class SherpaOnnxSpeechService extends EventEmitter {
    private recognizer: any = null
    private stream: any = null
    private isRunning: boolean = false
    private currentLanguage: string = 'en'
    private lastText: string = ''
    private isOfflineMode: boolean = false
    private isDecoding: boolean = false

    // Offline mode: accumulate audio, decode on silence
    private audioBuffer: Float32Array[] = []
    private accumulatedSamples: number = 0
    private silenceThreshold: number = 0.01
    private silenceSamples: number = 0
    private silenceFlushThreshold: number = 16000 * 1.5 // 1.5s of silence → flush

    // Optional audio preprocessor (e.g., VAD) — set by main.ts
    public audioPreprocessor: ((chunk: Buffer) => void) | null = null

    constructor() {
        super()
        this.setupHandlers()
    }

    private setupHandlers() {
        ipcMain.handle('start-sherpa-transcription', async (_, config: SherpaOnnxConfig) => {
            return this.start(config)
        })

        ipcMain.handle('stop-sherpa-transcription', async () => {
            return this.stop()
        })

        // Handler for receiving audio chunks from renderer
        ipcMain.on('sherpa-audio-chunk', (_, audioData: ArrayBuffer) => {
            const buffer = Buffer.from(audioData)
            if (this.audioPreprocessor) {
                this.audioPreprocessor(buffer)
            } else {
                this.writeAudio(buffer)
            }
        })
    }

    async start(config: SherpaOnnxConfig): Promise<boolean> {
        try {
            if (this.isRunning) {
                await this.stop()
            }

            const { modelDir, sampleRate = 16000, language = 'en' } = config
            this.currentLanguage = language

            // Verify model directory exists
            if (!fs.existsSync(modelDir)) {
                console.error(`[SherpaOnnx] Model not found at: ${modelDir}`)
                this.emit('error', `Model not found at: ${modelDir}`)
                return false
            }

            // Detect model files
            const files = fs.readdirSync(modelDir)
            const tokensFile = files.find(f => f.includes('tokens'))
            const encoderFile = files.find(f => f.includes('encoder') && f.endsWith('.onnx'))
            const decoderFile = files.find(f => f.includes('decoder') && f.endsWith('.onnx'))
            const joinerFile = files.find(f => f.includes('joiner') && f.endsWith('.onnx'))
            // CTC/offline model detection
            const ctcModelFile = files.find(f =>
                f.endsWith('.onnx') &&
                !f.includes('tokens') &&
                !f.includes('encoder') &&
                !f.includes('decoder') &&
                !f.includes('joiner') &&
                (f.includes('ctc') || f === 'model.onnx' || f.includes('model'))
            )

            if (!tokensFile) {
                console.error(`[SherpaOnnx] tokens file not found in ${modelDir}`)
                this.emit('error', 'tokens file not found in model directory')
                return false
            }

            const sherpa = _require('sherpa-onnx-node')

            // Determine if online (streaming) or offline model
            if (encoderFile && decoderFile && joinerFile) {
                // ── ONLINE: Transducer model (Zipformer, Conformer) ──
                this.isOfflineMode = false
                const recognizerConfig = {
                    featConfig: { sampleRate, featureDim: 80 },
                    modelConfig: {
                        tokens: path.join(modelDir, tokensFile),
                        numThreads: 2,
                        debug: false,
                        provider: 'cpu',
                        transducer: {
                            encoder: path.join(modelDir, encoderFile),
                            decoder: path.join(modelDir, decoderFile),
                            joiner: path.join(modelDir, joinerFile),
                        },
                    },
                    decodingMethod: 'greedy_search',
                    enableEndpoint: true,
                    rule1MinTrailingSilence: 2.4,
                    rule2MinTrailingSilence: 1.2,
                    rule3MinUtteranceLength: 20.0,
                }
                console.log(`[SherpaOnnx] Detected ONLINE transducer model`)
                this.recognizer = new sherpa.OnlineRecognizer(recognizerConfig)
                this.stream = this.recognizer.createStream()

            } else if (ctcModelFile) {
                // ── OFFLINE: CTC model ──
                this.isOfflineMode = true

                // Detect if omnilingual vs NeMo CTC based on dir name
                const dirName = path.basename(modelDir).toLowerCase()
                const isOmnilingual = dirName.includes('omnilingual')

                const modelFilePath = path.join(modelDir, ctcModelFile)
                const tokensPath = path.join(modelDir, tokensFile)

                let modelSpecificConfig: any
                if (isOmnilingual) {
                    modelSpecificConfig = {
                        omnilingual: { model: modelFilePath },
                    }
                    console.log(`[SherpaOnnx] Detected OFFLINE Omnilingual CTC model: ${ctcModelFile}`)
                } else {
                    modelSpecificConfig = {
                        nemoCtc: { model: modelFilePath },
                    }
                    console.log(`[SherpaOnnx] Detected OFFLINE NeMo CTC model: ${ctcModelFile}`)
                }

                const recognizerConfig = {
                    modelConfig: {
                        ...modelSpecificConfig,
                        tokens: tokensPath,
                        numThreads: 2,
                        debug: false,
                        provider: 'cpu',
                    },
                }
                this.recognizer = new sherpa.OfflineRecognizer(recognizerConfig)
                // No persistent stream for offline mode — created per decode

            } else {
                // Try paraformer (streaming)
                const modelFile = files.find(f => f.endsWith('.onnx') && !f.includes('tokens'))
                if (modelFile) {
                    this.isOfflineMode = false
                    const recognizerConfig = {
                        featConfig: { sampleRate, featureDim: 80 },
                        modelConfig: {
                            tokens: path.join(modelDir, tokensFile),
                            numThreads: 2,
                            debug: false,
                            provider: 'cpu',
                            paraformer: {
                                encoder: path.join(modelDir, modelFile),
                            },
                        },
                        decodingMethod: 'greedy_search',
                        enableEndpoint: true,
                        rule1MinTrailingSilence: 2.4,
                        rule2MinTrailingSilence: 1.2,
                        rule3MinUtteranceLength: 20.0,
                    }
                    console.log(`[SherpaOnnx] Detected paraformer model: ${modelFile}`)
                    this.recognizer = new sherpa.OnlineRecognizer(recognizerConfig)
                    this.stream = this.recognizer.createStream()
                } else {
                    console.error(`[SherpaOnnx] No recognized model files in ${modelDir}`)
                    this.emit('error', 'No recognized model files found')
                    return false
                }
            }

            this.lastText = ''
            this.audioBuffer = []
            this.accumulatedSamples = 0
            this.silenceSamples = 0
            this.isRunning = true

            console.log(`[SherpaOnnx] Started (mode: ${this.isOfflineMode ? 'OFFLINE' : 'ONLINE'}, language: ${language})`)
            return true
        } catch (error) {
            console.error('[SherpaOnnx] Failed to start:', error)
            this.emit('error', String(error))
            return false
        }
    }

    /**
     * Process audio chunk. Input: 16-bit PCM mono at 16kHz.
     */
    writeAudio(audioChunk: Buffer): void {
        if (!this.isRunning || !this.recognizer) return

        try {
            const float32 = this.pcmToFloat32(audioChunk)

            if (this.isOfflineMode) {
                this.writeAudioOffline(float32)
            } else {
                this.writeAudioOnline(float32)
            }
        } catch (error) {
            console.error('[SherpaOnnx] Audio processing error:', error)
        }
    }

    /**
     * ONLINE mode: feed to streaming recognizer, get results continuously.
     */
    private writeAudioOnline(float32: Float32Array): void {
        this.stream.acceptWaveform({ samples: float32, sampleRate: 16000 })

        while (this.recognizer.isReady(this.stream)) {
            this.recognizer.decode(this.stream)
        }

        const result = this.recognizer.getResult(this.stream)
        const isEndpoint = this.recognizer.isEndpoint(this.stream)

        if (result.text && result.text.trim().length > 0) {
            if (isEndpoint) {
                this.emit('transcript', {
                    text: result.text.trim(),
                    isFinal: true,
                    language: this.currentLanguage,
                    provider: 'SHERPA_ONNX',
                    confidence: 0.9,
                })
                this.lastText = ''
                this.recognizer.reset(this.stream)
            } else if (result.text.trim() !== this.lastText) {
                this.lastText = result.text.trim()
                this.emit('transcript', {
                    text: this.lastText,
                    isFinal: false,
                    language: this.currentLanguage,
                    provider: 'SHERPA_ONNX',
                    confidence: 0.0,
                })
            }
        } else if (isEndpoint) {
            this.recognizer.reset(this.stream)
        }
    }

    /**
     * OFFLINE mode: accumulate audio, decode only when silence is detected.
     * No periodic interim decodes — the 1B model is too heavy for that.
     */
    private writeAudioOffline(float32: Float32Array): void {
        // Store chunk
        this.audioBuffer.push(float32)
        this.accumulatedSamples += float32.length

        // Simple energy-based silence detection
        let energy = 0
        for (let i = 0; i < float32.length; i++) {
            energy += float32[i] * float32[i]
        }
        energy = Math.sqrt(energy / float32.length)

        if (energy < this.silenceThreshold) {
            this.silenceSamples += float32.length
        } else {
            this.silenceSamples = 0
        }

        // Only decode when silence is detected after speech
        // Minimum 0.5s of audio to avoid decoding noise
        const minSamples = 16000 * 0.5
        if (this.silenceSamples >= this.silenceFlushThreshold && this.accumulatedSamples > minSamples) {
            // Grab current buffer and clear immediately
            const bufferToProcess = this.audioBuffer
            this.audioBuffer = []
            this.accumulatedSamples = 0
            this.silenceSamples = 0

            // Fire async decode (non-blocking)
            this.decodeOfflineBufferAsync(bufferToProcess).catch(err => {
                console.error('[SherpaOnnx] Async decode error:', err)
            })
        }
    }

    /**
     * Async decode of audio buffer using OfflineRecognizer.
     * Uses decodeAsync to avoid blocking main thread.
     */
    private async decodeOfflineBufferAsync(chunks: Float32Array[]): Promise<void> {
        if (chunks.length === 0 || !this.recognizer || this.isDecoding) return

        this.isDecoding = true
        try {
            // Merge all chunks into one Float32Array
            const totalSamples = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
            const merged = new Float32Array(totalSamples)
            let offset = 0
            for (const chunk of chunks) {
                merged.set(chunk, offset)
                offset += chunk.length
            }

            console.log(`[SherpaOnnx] Decoding ${(totalSamples / 16000).toFixed(1)}s of audio...`)

            // Create offline stream, feed audio, decode asynchronously
            const stream = this.recognizer.createStream()
            stream.acceptWaveform({ samples: merged, sampleRate: 16000 })

            // Use async decode to not block main thread
            await this.recognizer.decodeAsync(stream)

            const result = this.recognizer.getResult(stream)
            const text = (result?.text || '').trim()

            console.log(`[SherpaOnnx] Decoded result: "${text}"`)

            if (text.length > 0) {
                this.emit('transcript', {
                    text,
                    isFinal: true,
                    language: this.currentLanguage,
                    provider: 'SHERPA_ONNX',
                    confidence: 0.9,
                })
                this.lastText = ''
            }
        } catch (error) {
            console.error('[SherpaOnnx] Offline decode error:', error)
        } finally {
            this.isDecoding = false
        }
    }

    /**
     * Convert 16-bit signed PCM buffer to Float32Array in [-1, 1] range.
     */
    private pcmToFloat32(pcmBuffer: Buffer): Float32Array {
        const samples = pcmBuffer.length / 2
        const float32 = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
            const int16 = pcmBuffer.readInt16LE(i * 2)
            float32[i] = int16 / 32768.0
        }
        return float32
    }

    async stop(): Promise<void> {
        if (!this.isRunning) return

        try {
            if (this.isOfflineMode && this.audioBuffer.length > 0) {
                // Flush remaining offline audio
                await this.decodeOfflineBufferAsync(this.audioBuffer)
            } else if (!this.isOfflineMode && this.stream && this.recognizer) {
                // Flush streaming model
                this.stream.inputFinished()
                while (this.recognizer.isReady(this.stream)) {
                    this.recognizer.decode(this.stream)
                }
                const result = this.recognizer.getResult(this.stream)
                if (result.text && result.text.trim().length > 0) {
                    this.emit('transcript', {
                        text: result.text.trim(),
                        isFinal: true,
                        language: this.currentLanguage,
                        provider: 'SHERPA_ONNX',
                        confidence: 0.9,
                    })
                }
            }

            this.stream = null
            this.recognizer = null
            this.isRunning = false
            this.isOfflineMode = false
            this.lastText = ''
            this.audioBuffer = []
            this.accumulatedSamples = 0
            this.silenceSamples = 0
            console.log('[SherpaOnnx] Stopped')
        } catch (error) {
            console.error('[SherpaOnnx] Error stopping:', error)
            this.isRunning = false
        }
    }

    get running(): boolean {
        return this.isRunning
    }
}
