import { EventEmitter } from 'events'
import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'

export interface SherpaOnnxConfig {
    modelDir: string        // Path to the sherpa-onnx model directory (contains tokens.txt, *.onnx files)
    modelType?: string      // 'transducer' | 'paraformer' | 'zipformer2Ctc' | 'nemoCtc'
    sampleRate?: number     // Default 16000
    language?: string       // Language code for result metadata
}

/**
 * SherpaOnnxSpeechService provides offline streaming ASR using sherpa-onnx.
 *
 * Replaces VoskSpeechService with a more versatile ONNX-based engine that
 * supports multiple model architectures (Zipformer, Conformer, NeMo, etc.)
 *
 * Same EventEmitter interface as GcpSpeechService:
 * - start(config) → load model + create stream
 * - writeAudio(chunk) → process audio, emit partial/final results
 * - stop() → cleanup
 * - emit('transcript', result)
 *
 * Input: 16-bit PCM mono (same as GCP)
 *
 * Models: Download from https://github.com/k2-fsa/sherpa-onnx/releases
 */
export class SherpaOnnxSpeechService extends EventEmitter {
    private recognizer: any = null
    private stream: any = null
    private isRunning: boolean = false
    private currentLanguage: string = 'en'
    private lastText: string = ''

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

            if (!tokensFile) {
                console.error(`[SherpaOnnx] tokens file not found in ${modelDir}`)
                this.emit('error', 'tokens file not found in model directory')
                return false
            }

            // Dynamic import
            const { OnlineRecognizer } = require('sherpa-onnx-node')

            // Build config based on available model files
            const recognizerConfig: any = {
                featConfig: {
                    sampleRate: sampleRate,
                    featureDim: 80,
                },
                modelConfig: {
                    tokens: path.join(modelDir, tokensFile),
                    numThreads: 2,
                    debug: false,
                    provider: 'cpu',
                },
                decodingMethod: 'greedy_search',
                enableEndpoint: true,
                rule1MinTrailingSilence: 2.4,  // seconds of silence to trigger endpoint
                rule2MinTrailingSilence: 1.2,
                rule3MinUtteranceLength: 20.0,
            }

            // Configure model type based on available files
            if (encoderFile && decoderFile && joinerFile) {
                // Transducer model (Zipformer, Conformer, etc.)
                recognizerConfig.modelConfig.transducer = {
                    encoder: path.join(modelDir, encoderFile),
                    decoder: path.join(modelDir, decoderFile),
                    joiner: path.join(modelDir, joinerFile),
                }
            } else {
                // Try paraformer or other single-file models
                const modelFile = files.find(f => f.endsWith('.onnx') && !f.includes('tokens'))
                if (modelFile) {
                    recognizerConfig.modelConfig.paraformer = {
                        encoder: path.join(modelDir, modelFile),
                    }
                }
            }

            console.log(`[SherpaOnnx] Loading model from: ${modelDir}`)
            this.recognizer = new OnlineRecognizer(recognizerConfig)
            this.stream = this.recognizer.createStream()
            this.lastText = ''

            this.isRunning = true
            console.log(`[SherpaOnnx] Started (language: ${language}, sampleRate: ${sampleRate})`)
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
        if (!this.isRunning || !this.recognizer || !this.stream) return

        try {
            // Convert 16-bit PCM to Float32Array [-1, 1]
            const float32 = this.pcmToFloat32(audioChunk)

            // Feed audio to sherpa-onnx
            this.stream.acceptWaveform({ samples: float32, sampleRate: 16000 })

            // Process while ready
            while (this.recognizer.isReady(this.stream)) {
                this.recognizer.decode(this.stream)
            }

            // Get current result
            const result = this.recognizer.getResult(this.stream)

            // Check for endpoint (silence detected = final result)
            const isEndpoint = this.recognizer.isEndpoint(this.stream)

            if (result.text && result.text.trim().length > 0) {
                if (isEndpoint) {
                    // Final result — utterance complete
                    this.emit('transcript', {
                        text: result.text.trim(),
                        isFinal: true,
                        language: this.currentLanguage,
                        provider: 'SHERPA_ONNX',
                        confidence: 0.9,  // sherpa-onnx doesn't provide per-utterance confidence
                        tokens: result.tokens
                    })
                    this.lastText = ''
                    // Reset stream for next utterance
                    this.recognizer.reset(this.stream)
                } else if (result.text.trim() !== this.lastText) {
                    // Partial result changed
                    this.lastText = result.text.trim()
                    this.emit('transcript', {
                        text: this.lastText,
                        isFinal: false,
                        language: this.currentLanguage,
                        provider: 'SHERPA_ONNX',
                        confidence: 0.0,
                        tokens: result.tokens
                    })
                }
            } else if (isEndpoint) {
                // Empty endpoint — reset
                this.recognizer.reset(this.stream)
            }
        } catch (error) {
            console.error('[SherpaOnnx] Audio processing error:', error)
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
            if (this.stream && this.recognizer) {
                // Flush remaining audio
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
                        tokens: result.tokens
                    })
                }
            }

            this.stream = null
            this.recognizer = null
            this.isRunning = false
            this.lastText = ''
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
