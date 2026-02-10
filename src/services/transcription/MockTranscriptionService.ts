import { ITranscriptionService } from './ITranscriptionService'

export class MockTranscriptionService implements ITranscriptionService {
    private listeners: Map<string, Function[]> = new Map()
    private intervalId: any = null

    async connect(): Promise<void> {
        console.log('Mock Service Connected')
    }

    async disconnect(): Promise<void> {
        this.stop()
        console.log('Mock Service Disconnected')
    }

    async start(audioStream?: AsyncGenerator<Uint8Array>): Promise<void> {
        console.log('Mock Service Started', audioStream)
        const words = ['Hello', 'world', 'this', 'is', 'a', 'live', 'subtitle', 'test', 'using', 'mock', 'data']
        let currentIndex = 0

        this.intervalId = setInterval(() => {
            const text = words.slice(0, currentIndex + 1).join(' ')
            const isFinal = Math.random() > 0.8

            this.emit('transcript', {
                text: text,
                isFinal: isFinal
            })

            if (isFinal) {
                currentIndex = 0
            } else {
                currentIndex = (currentIndex + 1) % words.length
            }
        }, 500)
    }

    async stop(): Promise<void> {
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }
    }

    on(event: 'transcript' | 'error', listener: Function): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, [])
        }
        this.listeners.get(event)?.push(listener)
    }

    private emit(event: string, data: any) {
        this.listeners.get(event)?.forEach(listener => listener(data))
    }
}
