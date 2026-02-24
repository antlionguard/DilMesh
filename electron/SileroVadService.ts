import { EventEmitter } from 'events'
import { ipcMain } from 'electron'

export interface VadConfig {
    enabled: boolean
    positiveSpeechThreshold: number   // 0.0-1.0, default 0.5
    negativeSpeechThreshold: number   // 0.0-1.0, default 0.35
    preSpeechPadFrames: number        // frames to include before speech, default 1
    redemptionFrames: number          // frames to wait before ending speech, default 8
    minSpeechFrames: number           // minimum frames for valid speech, default 3
}

const DEFAULT_CONFIG: VadConfig = {
    enabled: true,
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    preSpeechPadFrames: 1,
    redemptionFrames: 8,
    minSpeechFrames: 3
}

/**
 * SileroVadService wraps avr-vad (Silero VAD v5 ONNX) for voice activity detection.
 *
 * Sits between the microphone audio stream and STT providers:
 *   Microphone → VAD → (speech chunks only) → STT Provider
 *
 * Events:
 *   'speech-start'          — Speech detected, begin forwarding audio
 *   'speech-end'            — Speech ended
 *   'audio-for-stt'(chunk)  — Audio chunk that should be forwarded to the active STT
 *   'vad-status'(status)    — Status updates for UI
 */
export class SileroVadService extends EventEmitter {
    private vad: any = null  // RealTimeVAD instance
    private config: VadConfig = { ...DEFAULT_CONFIG }
    private isSpeaking: boolean = false
    private isInitialized: boolean = false

    constructor() {
        super()
        this.setupHandlers()
    }

    private setupHandlers() {
        ipcMain.handle('vad-get-config', () => {
            return this.config
        })

        ipcMain.handle('vad-update-config', async (_, newConfig: Partial<VadConfig>) => {
            this.config = { ...this.config, ...newConfig }
            // If VAD is running, restart with new config
            if (this.isInitialized) {
                await this.restart()
            }
            return this.config
        })
    }

    async initialize(config?: Partial<VadConfig>): Promise<boolean> {
        if (config) {
            this.config = { ...this.config, ...config }
        }

        if (!this.config.enabled) {
            console.log('[VAD] Disabled, passthrough mode')
            this.isInitialized = false
            return true
        }

        try {
            // Dynamic import to avoid issues if onnxruntime-node is not built
            const { RealTimeVAD } = await import('avr-vad')

            if (this.vad) {
                this.vad.destroy()
            }

            this.vad = await RealTimeVAD.new({
                model: 'v5',
                sampleRate: 16000,
                positiveSpeechThreshold: this.config.positiveSpeechThreshold,
                negativeSpeechThreshold: this.config.negativeSpeechThreshold,
                preSpeechPadFrames: this.config.preSpeechPadFrames,
                redemptionFrames: this.config.redemptionFrames,
                minSpeechFrames: this.config.minSpeechFrames,

                // Callbacks
                onSpeechStart: () => {
                    this.isSpeaking = true
                    console.log('[VAD] 🎙️ Speech started')
                    this.emit('speech-start')
                },
                onSpeechRealStart: () => {
                    // Called after minSpeechFrames confirms it's real speech
                },
                onSpeechEnd: (audio: Float32Array) => {
                    this.isSpeaking = false
                    console.log(`[VAD] 🔇 Speech ended (${audio.length} samples)`)
                    this.emit('speech-end')
                },
                onFrameProcessed: (_probabilities: { isSpeech: number; notSpeech: number }, _frame: Float32Array) => {
                    // Called for every processed frame — we use this to decide
                    // whether to forward audio to STT
                },
                onVADMisfire: () => {
                    // Speech was too short (below minSpeechFrames), reset
                    this.isSpeaking = false
                }
            })

            this.vad.start()
            this.isInitialized = true
            this.isSpeaking = false
            console.log('[VAD] Silero VAD v5 initialized successfully')
            this.emit('vad-status', { initialized: true, enabled: true })
            return true
        } catch (error) {
            console.error('[VAD] Failed to initialize Silero VAD:', error)
            this.isInitialized = false
            this.emit('vad-status', { initialized: false, error: String(error) })
            return false
        }
    }

    /**
     * Process incoming audio chunk from microphone.
     * Input: Buffer of 16-bit PCM (LINEAR16) at 16kHz mono.
     *
     * If VAD is disabled, the chunk is forwarded directly.
     * If VAD is enabled, only speech segments are forwarded.
     */
    async processAudio(pcmBuffer: Buffer): Promise<void> {
        // If VAD is disabled, pass through everything
        if (!this.config.enabled || !this.isInitialized || !this.vad) {
            this.emit('audio-for-stt', pcmBuffer)
            return
        }

        // Convert 16-bit PCM Buffer to Float32Array [-1, 1]
        const float32 = this.pcmToFloat32(pcmBuffer)

        // Feed audio to VAD — it will call onSpeechStart/onSpeechEnd callbacks
        try {
            await this.vad.processAudio(float32)
        } catch (error) {
            console.error('[VAD] processAudio error:', error)
        }

        // Forward audio to STT if currently speaking
        // We always forward during speech regardless of VAD callback timing
        // to avoid losing audio between callback and next chunk
        if (this.isSpeaking) {
            this.emit('audio-for-stt', pcmBuffer)
        }
    }

    /**
     * Convert 16-bit signed PCM buffer to Float32Array in [-1, 1] range.
     */
    private pcmToFloat32(pcmBuffer: Buffer): Float32Array {
        const samples = pcmBuffer.length / 2  // 16-bit = 2 bytes per sample
        const float32 = new Float32Array(samples)
        for (let i = 0; i < samples; i++) {
            const int16 = pcmBuffer.readInt16LE(i * 2)
            float32[i] = int16 / 32768.0
        }
        return float32
    }

    private async restart(): Promise<void> {
        console.log('[VAD] Restarting with new config...')
        await this.initialize()
    }

    get speaking(): boolean {
        return this.isSpeaking
    }

    get enabled(): boolean {
        return this.config.enabled
    }

    get initialized(): boolean {
        return this.isInitialized
    }

    async destroy(): Promise<void> {
        if (this.vad) {
            this.vad.destroy()
            this.vad = null
        }
        this.isInitialized = false
        this.isSpeaking = false
        console.log('[VAD] Destroyed')
    }
}
