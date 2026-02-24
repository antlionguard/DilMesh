import { EventEmitter } from 'events'
import { ipcMain, app } from 'electron'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import fs from 'fs'

export interface RivaConfig {
    serverUrl: string       // e.g., 'localhost:50051'
    useSsl?: boolean
    sslCert?: string        // PEM certificate for SSL
    language?: string       // Language code (e.g., 'en-US')
    sampleRate?: number     // Default 16000
    enableAutoPunctuation?: boolean
    enableInterimResults?: boolean
}

/**
 * RivaSpeechService provides speech-to-text and translation using NVIDIA Riva.
 *
 * Riva gRPC services:
 * - RivaSpeechRecognition.StreamingRecognize → streaming ASR
 * - RivaTranslation.TranslateText → NMT
 *
 * Since the proto files are hosted on GitHub (nvidia-riva/common),
 * we download them once and cache locally, then use @grpc/proto-loader.
 *
 * Same EventEmitter interface as GcpSpeechService/SherpaOnnxSpeechService.
 */
export class RivaSpeechService extends EventEmitter {
    private client: any = null
    private nlpClient: any = null
    private stream: any = null
    private isRunning: boolean = false
    private currentLanguage: string = 'en-US'
    private config: RivaConfig | null = null

    // Optional audio preprocessor (e.g., VAD)
    public audioPreprocessor: ((chunk: Buffer) => void) | null = null

    // Proto directory — use userData to avoid ESM __dirname issues
    private protoDir: string

    constructor() {
        super()
        this.protoDir = path.join(app.getPath('userData'), 'protos', 'riva')
        this.setupHandlers()
    }

    private setupHandlers() {
        ipcMain.handle('start-riva-transcription', async (_, config: RivaConfig) => {
            return this.start(config)
        })

        ipcMain.handle('stop-riva-transcription', async () => {
            return this.stop()
        })

        ipcMain.handle('riva-translate', async (_, text: string, targetLang: string, sourceLang?: string) => {
            return this.translate(text, targetLang, sourceLang)
        })

        // Audio chunk handler
        ipcMain.on('riva-audio-chunk', (_, audioData: ArrayBuffer) => {
            const buffer = Buffer.from(audioData)
            if (this.audioPreprocessor) {
                this.audioPreprocessor(buffer)
            } else {
                this.writeAudio(buffer)
            }
        })
    }

    /**
     * Create gRPC credentials.
     */
    private createCredentials(config: RivaConfig): grpc.ChannelCredentials {
        if (config.useSsl && config.sslCert) {
            return grpc.credentials.createSsl(Buffer.from(config.sslCert))
        }
        if (config.useSsl) {
            return grpc.credentials.createSsl()
        }
        return grpc.credentials.createInsecure()
    }

    /**
     * Load gRPC service definitions from proto files.
     * Downloads proto files from nvidia-riva/common if not cached.
     */
    private async loadProtos() {
        // Check/create proto directory
        if (!fs.existsSync(this.protoDir)) {
            fs.mkdirSync(this.protoDir, { recursive: true })
        }

        const asrProtoPath = path.join(this.protoDir, 'riva_asr.proto')
        const nlpProtoPath = path.join(this.protoDir, 'riva_nmt.proto')

        // Create minimal proto definitions if files don't exist
        if (!fs.existsSync(asrProtoPath)) {
            fs.writeFileSync(asrProtoPath, RIVA_ASR_PROTO)
        }
        if (!fs.existsSync(nlpProtoPath)) {
            fs.writeFileSync(nlpProtoPath, RIVA_NMT_PROTO)
        }

        return { asrProtoPath, nlpProtoPath }
    }

    async start(config: RivaConfig): Promise<boolean> {
        try {
            if (this.isRunning) {
                await this.stop()
            }

            this.config = config
            this.currentLanguage = config.language || 'en-US'

            const { asrProtoPath, nlpProtoPath } = await this.loadProtos()
            const credentials = this.createCredentials(config)

            // Load ASR proto
            const asrPackageDef = protoLoader.loadSync(asrProtoPath, {
                keepCase: false,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true,
            })
            const asrGrpc = grpc.loadPackageDefinition(asrPackageDef)
            const asrService = (asrGrpc as any).nvidia.riva.asr.RivaSpeechRecognition
            this.client = new asrService(config.serverUrl, credentials)

            // Load NMT proto
            const nlpPackageDef = protoLoader.loadSync(nlpProtoPath, {
                keepCase: false,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true,
            })
            const nlpGrpc = grpc.loadPackageDefinition(nlpPackageDef)
            const nlpService = (nlpGrpc as any).nvidia.riva.nmt.RivaTranslation
            this.nlpClient = new nlpService(config.serverUrl, credentials)

            // Start streaming recognition
            this.startStreaming(config)

            this.isRunning = true
            console.log(`[Riva] Connected to ${config.serverUrl} (language: ${this.currentLanguage})`)
            return true
        } catch (error) {
            console.error('[Riva] Failed to start:', error)
            this.emit('error', String(error))
            return false
        }
    }

    private startStreaming(config: RivaConfig) {
        if (!this.client) return

        const streamingConfig = {
            config: {
                encoding: 0,  // LINEAR_PCM = 0
                sampleRateHertz: config.sampleRate || 16000,
                languageCode: this.currentLanguage,
                maxAlternatives: 1,
                enableAutomaticPunctuation: config.enableAutoPunctuation ?? true,
                enableWordTimeOffsets: false,
            },
            interimResults: config.enableInterimResults ?? true,
        }

        this.stream = this.client.StreamingRecognize()

        // Send initial config
        this.stream.write({
            streamingConfig: streamingConfig,
        })

        // Handle responses
        this.stream.on('data', (response: any) => {
            if (response.results && response.results.length > 0) {
                const result = response.results[0]
                if (result.alternatives && result.alternatives.length > 0) {
                    const alt = result.alternatives[0]
                    const text = alt.transcript?.trim()

                    if (text && text.length > 0) {
                        this.emit('transcript', {
                            text: text,
                            isFinal: result.isFinal || false,
                            language: this.currentLanguage,
                            provider: 'RIVA',
                            confidence: alt.confidence || 0.0,
                        })
                    }
                }
            }
        })

        this.stream.on('error', (error: any) => {
            console.error('[Riva] Stream error:', error)
            this.emit('error', String(error))

            // Attempt reconnect after brief delay
            if (this.isRunning && this.config) {
                setTimeout(() => {
                    if (this.isRunning && this.config) {
                        this.startStreaming(this.config)
                    }
                }, 2000)
            }
        })

        this.stream.on('end', () => {
            console.log('[Riva] Stream ended')
        })
    }

    /**
     * Process audio chunk. Input: 16-bit PCM mono at 16kHz.
     */
    writeAudio(audioChunk: Buffer): void {
        if (!this.isRunning || !this.stream) return

        try {
            this.stream.write({
                audioContent: audioChunk,
            })
        } catch (error) {
            console.error('[Riva] Write error:', error)
        }
    }

    /**
     * Translate text using Riva NMT.
     */
    async translate(text: string, targetLanguage: string, sourceLanguage?: string): Promise<string> {
        if (!this.nlpClient) {
            throw new Error('Riva NMT client not initialized')
        }

        return new Promise((resolve, reject) => {
            const request = {
                texts: [text],
                model: {
                    sourceLanguageCode: sourceLanguage || 'en',
                    targetLanguageCode: targetLanguage,
                },
            }

            this.nlpClient.TranslateText(request, (error: any, response: any) => {
                if (error) {
                    console.error('[Riva NMT] Translation error:', error)
                    reject(error)
                    return
                }

                if (response.translations && response.translations.length > 0) {
                    resolve(response.translations[0].text)
                } else {
                    resolve(text)  // Fallback to original
                }
            })
        })
    }

    async stop(): Promise<void> {
        if (!this.isRunning) return

        try {
            if (this.stream) {
                this.stream.end()
                this.stream = null
            }

            if (this.client) {
                this.client.close()
                this.client = null
            }

            if (this.nlpClient) {
                this.nlpClient.close()
                this.nlpClient = null
            }

            this.isRunning = false
            this.config = null
            console.log('[Riva] Stopped')
        } catch (error) {
            console.error('[Riva] Error stopping:', error)
            this.isRunning = false
        }
    }

    get running(): boolean {
        return this.isRunning
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Embedded Proto Definitions (minimal, matching Riva API)
// Full proto: https://github.com/nvidia-riva/common/tree/main/riva/proto
// ═══════════════════════════════════════════════════════════════════════════

const RIVA_ASR_PROTO = `
syntax = "proto3";
package nvidia.riva.asr;

service RivaSpeechRecognition {
  rpc StreamingRecognize (stream StreamingRecognizeRequest) returns (stream StreamingRecognizeResponse);
  rpc Recognize (RecognizeRequest) returns (RecognizeResponse);
}

message RecognizeRequest {
  RecognitionConfig config = 1;
  bytes audio = 2;
}

message RecognizeResponse {
  repeated SpeechRecognitionResult results = 1;
}

message StreamingRecognizeRequest {
  oneof streaming_request {
    StreamingRecognitionConfig streaming_config = 1;
    bytes audio_content = 2;
  }
}

message StreamingRecognizeResponse {
  repeated StreamingRecognitionResult results = 2;
}

message StreamingRecognitionConfig {
  RecognitionConfig config = 1;
  bool interim_results = 2;
}

message RecognitionConfig {
  int32 encoding = 1;
  int32 sample_rate_hertz = 2;
  string language_code = 3;
  int32 max_alternatives = 4;
  bool enable_automatic_punctuation = 11;
  bool enable_word_time_offsets = 8;
}

message StreamingRecognitionResult {
  repeated SpeechRecognitionAlternative alternatives = 1;
  bool is_final = 2;
  float stability = 3;
}

message SpeechRecognitionResult {
  repeated SpeechRecognitionAlternative alternatives = 1;
}

message SpeechRecognitionAlternative {
  string transcript = 1;
  float confidence = 2;
}
`;

const RIVA_NMT_PROTO = `
syntax = "proto3";
package nvidia.riva.nmt;

service RivaTranslation {
  rpc TranslateText (TranslateTextRequest) returns (TranslateTextResponse);
}

message TranslateTextRequest {
  repeated string texts = 1;
  TranslationModel model = 2;
}

message TranslateTextResponse {
  repeated Translation translations = 1;
}

message Translation {
  string text = 1;
  string language = 2;
}

message TranslationModel {
  string source_language_code = 1;
  string target_language_code = 2;
}
`;
