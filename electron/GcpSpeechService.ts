import { ipcMain, BrowserWindow } from 'electron'
import { SpeechClient, protos } from '@google-cloud/speech'

type IRecognitionConfig = protos.google.cloud.speech.v1.IRecognitionConfig

export class GcpSpeechService {
    private client: SpeechClient | null = null
    private recognizeStream: any = null
    private isRunning: boolean = false

    // Store config for auto-restart
    private currentGcpKeyJson: string = ''
    private currentLanguage: string = 'en-US'
    private currentModel: string = 'latest_long'
    private currentEncoding: string = 'LINEAR16'
    private currentInterimResults: boolean = true
    private currentAutoPunctuation: boolean = true
    private currentUseEnhanced: boolean = false
    private currentSingleUtterance: boolean = false
    private currentMaxAlternatives: number = 1
    private restartTimeout: NodeJS.Timeout | null = null

    constructor() {
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
        language?: string,
        gcpModel?: string,
        gcpEncoding?: string,
        gcpInterimResults?: boolean,
        gcpAutoPunctuation?: boolean,
        gcpUseEnhanced?: boolean,
        gcpSingleUtterance?: boolean,
        gcpMaxAlternatives?: number
    }): Promise<boolean> {
        try {
            // Store config for potential restart
            this.currentGcpKeyJson = config.gcpKeyJson || ''
            this.currentLanguage = config.language || 'en-US'
            this.currentModel = config.gcpModel || 'latest_long'
            this.currentEncoding = config.gcpEncoding || 'LINEAR16'
            this.currentInterimResults = config.gcpInterimResults ?? true
            this.currentAutoPunctuation = config.gcpAutoPunctuation ?? true
            this.currentUseEnhanced = config.gcpUseEnhanced ?? false
            this.currentSingleUtterance = config.gcpSingleUtterance ?? false
            this.currentMaxAlternatives = config.gcpMaxAlternatives ?? 1

            // Initialize client with credentials (only if not already created)
            if (!this.client) {
                if (this.currentGcpKeyJson) {
                    const credentials = JSON.parse(this.currentGcpKeyJson)
                    this.client = new SpeechClient({ credentials })
                } else {
                    this.client = new SpeechClient()
                }
            }

            this.isRunning = true

            // Create new stream
            await this.createStream()

            console.log('GCP Speech transcription started')
            return true
        } catch (error) {
            console.error('Failed to start GCP Speech:', error)
            return false
        }
    }

    private async createStream(): Promise<void> {
        // Map language codes
        const languageMap: Record<string, string> = {
            'auto': 'en-US',
            'en': 'en-US',
            'tr': 'tr-TR',
            'en-US': 'en-US',
            'tr-TR': 'tr-TR'
        }

        const languageCode = languageMap[this.currentLanguage] || 'en-US'

        const recognitionConfig: IRecognitionConfig = {
            encoding: this.currentEncoding as any,
            sampleRateHertz: 16000,
            languageCode: languageCode,
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

        // Create streaming recognize request
        this.recognizeStream = this.client!
            ._streamingRecognize()
            .on('data', (response: protos.google.cloud.speech.v1.IStreamingRecognizeResponse) => {
                if (response.results && response.results.length > 0) {
                    const result = response.results[0]
                    if (result.alternatives && result.alternatives.length > 0) {
                        const transcript = result.alternatives[0].transcript
                        // Broadcast to projection windows only
                        BrowserWindow.getAllWindows().forEach(win => {
                            // Only send to projection windows (not main dashboard)
                            if (win.getTitle && win.getTitle().length > 0 && !win.getTitle().includes('Dashboard')) {
                                win.webContents.send('transcript-update', {
                                    provider: 'GCP',
                                    text: transcript || '',
                                    isFinal: result.isFinal || false
                                })
                            }
                        })
                    }
                }
            })
            .on('error', (error: Error) => {
                console.log('GCP Speech stream error, will auto-restart:', error.message)
                this.scheduleRestart()
            })
            .on('end', () => {
                console.log('GCP Speech stream ended')
                this.scheduleRestart()
            })

        // Send streaming config first
        this.recognizeStream.write({ streamingConfig: streamingRequest })
    }

    private scheduleRestart(): void {
        // Only restart if we're still supposed to be running
        if (!this.isRunning) return

        // Clear any existing restart timeout
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout)
        }

        // Restart after a short delay (100ms)
        this.restartTimeout = setTimeout(async () => {
            if (this.isRunning) {
                console.log('Auto-restarting GCP Speech stream...')
                try {
                    await this.createStream()
                    console.log('GCP Speech stream restarted successfully')
                } catch (error) {
                    console.error('Failed to restart GCP stream:', error)
                    // Try again after 1 second
                    this.scheduleRestart()
                }
            }
        }, 100)
    }

    // Method to receive audio chunks from renderer
    writeAudio(audioChunk: Buffer) {
        if (this.recognizeStream && this.isRunning) {
            try {
                this.recognizeStream.write({ audioContent: audioChunk })
            } catch (error) {
                // Stream might be closed, will be restarted
                console.log('Write error, stream will restart')
            }
        }
    }

    async stop(): Promise<void> {
        this.isRunning = false

        // Clear restart timeout
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout)
            this.restartTimeout = null
        }

        if (this.recognizeStream) {
            try {
                this.recognizeStream.end()
            } catch (e) {
                // Ignore end errors
            }
            this.recognizeStream = null
        }
        if (this.client) {
            await this.client.close()
            this.client = null
        }
        console.log('GCP Speech transcription stopped')
    }
}
