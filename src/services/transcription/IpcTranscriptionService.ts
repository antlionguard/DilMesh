import { ITranscriptionService, TranscriptionResult } from './ITranscriptionService'

export class IpcTranscriptionService implements ITranscriptionService {
    private listeners: Record<string, Function[]> = {}
    private provider: 'LOCAL' | 'GCP'

    constructor(provider: 'LOCAL' | 'GCP' = 'LOCAL') {
        this.provider = provider
        this.setupListeners()
    }

    private setupListeners() {
        // Listen for updates from Main process
        window.ipcRenderer.on('transcript-update', (_event, data: any) => {
            // data: { text, isFinal, provider }
            if (data.provider === this.provider) {
                const result: TranscriptionResult = {
                    text: data.text,
                    isFinal: data.isFinal
                }
                this.emit('transcript', result)
            }
        })
    }

    async connect(): Promise<void> {
        // No connection setup needed for IPC
    }

    async disconnect(): Promise<void> {
        await this.stop()
    }

    async start(_audioStream: AsyncGenerator<Uint8Array>): Promise<void> {
        const settings = await window.ipcRenderer.invoke('get-settings', 'transcription')

        if (this.provider === 'GCP') {
            // Start GCP transcription
            console.log('Starting GCP Transcription')
            await window.ipcRenderer.invoke('start-gcp-transcription', {
                gcpKeyJson: settings?.gcpKeyJson || '',
                language: settings?.language || 'en-US'
            })
        } else {
            // Start LOCAL (Whisper) transcription
            const deviceId = 0
            const language = settings?.language || 'auto'
            console.log('Starting Local Transcription on device', deviceId, 'language', language)
            await window.ipcRenderer.invoke('start-local-transcription', { deviceId, language })
        }
    }

    async stop(): Promise<void> {
        if (this.provider === 'GCP') {
            await window.ipcRenderer.invoke('stop-gcp-transcription')
        } else {
            await window.ipcRenderer.invoke('stop-local-transcription')
        }
    }

    on(event: 'transcript', listener: (result: TranscriptionResult) => void): void
    on(event: 'error', listener: (error: Error) => void): void
    on(event: string, listener: Function): void {
        if (!this.listeners[event]) {
            this.listeners[event] = []
        }
        this.listeners[event].push(listener)
    }

    private emit(event: string, ...args: any[]): void {
        if (this.listeners[event]) {
            this.listeners[event].forEach(listener => listener(...args))
        }
    }
}
