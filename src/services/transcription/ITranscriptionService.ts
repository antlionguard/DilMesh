export interface TranscriptionResult {
    text: string
    isFinal: boolean
    language?: string
}

export interface ITranscriptionService {
    connect(): Promise<void>
    disconnect(): Promise<void>
    start(audioStream?: AsyncGenerator<Uint8Array>): Promise<void>
    stop(): Promise<void>
    on(event: 'transcript', listener: (result: TranscriptionResult) => void): void
    on(event: 'error', listener: (error: Error) => void): void
}

export interface TranscriptionConfig {
    provider: 'AWS' | 'GCP' | 'MOCK'
    region?: string
    language?: string
    accessKeyId?: string
    secretAccessKey?: string
    gcpKeyJson?: string // JSON content of service account key
}
