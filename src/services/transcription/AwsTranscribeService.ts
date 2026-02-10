import { TranscribeStreamingClient, StartStreamTranscriptionCommand, LanguageCode, MediaEncoding } from "@aws-sdk/client-transcribe-streaming";
import { ITranscriptionService, TranscriptionResult, TranscriptionConfig } from "./ITranscriptionService";
// import { Buffer } from "buffer";

export class AwsTranscribeService implements ITranscriptionService {
    private client: TranscribeStreamingClient;
    private config: TranscriptionConfig;
    private listeners: Map<string, Function[]> = new Map();
    private stream: AsyncGenerator<Uint8Array> | null = null;
    private isRunning: boolean = false;

    constructor(config: TranscriptionConfig) {
        this.config = config;
        this.client = new TranscribeStreamingClient({
            region: config.region || "us-east-1",
            credentials: {
                accessKeyId: config.accessKeyId || "",
                secretAccessKey: config.secretAccessKey || "",
            },
        });
    }

    async connect(): Promise<void> {
        // AWS SDK handles connection lazily on command execution
        console.log("AWS Transcribe Client Initialized");
    }

    async disconnect(): Promise<void> {
        this.stop();
        this.client.destroy();
    }

    // Expects an AsyncIterable<Uint8Array> representing audio chunks
    async start(audioStream: AsyncGenerator<Uint8Array>): Promise<void> {
        this.isRunning = true;
        this.stream = audioStream;

        const command = new StartStreamTranscriptionCommand({
            LanguageCode: (this.config.language as LanguageCode) || LanguageCode.EN_US,
            MediaEncoding: MediaEncoding.PCM,
            MediaSampleRateHertz: 44100, // Should match microphone input
            AudioStream: this.audioStreamGenerator(),
        });

        try {
            const response = await this.client.send(command);

            if (response.TranscriptResultStream) {
                for await (const event of response.TranscriptResultStream) {
                    if (!this.isRunning) break;

                    if (event.TranscriptEvent) {
                        const results = event.TranscriptEvent.Transcript?.Results;
                        if (results && results.length > 0) {
                            const result = results[0];
                            if (result.Alternatives && result.Alternatives.length > 0) {
                                const transcript = result.Alternatives[0].Transcript;
                                this.emit("transcript", {
                                    text: transcript,
                                    isFinal: !result.IsPartial,
                                } as TranscriptionResult);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.emit("error", error);
        }
    }

    async stop(): Promise<void> {
        this.isRunning = false;
    }

    on(event: "transcript" | "error", listener: Function): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)?.push(listener);
    }

    private emit(event: string, data: any) {
        this.listeners.get(event)?.forEach((listener) => listener(data));
    }

    private async *audioStreamGenerator() {
        if (!this.stream) return;
        for await (const chunk of this.stream) {
            if (!this.isRunning) break;
            yield { AudioEvent: { AudioChunk: chunk } };
        }
    }
}
