import { ipcMain, app } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import https from 'https'

// ── Whisper Models ──────────────────────────────────────────────────────────
export const AVAILABLE_MODELS = [
    { id: 'tiny', name: 'Tiny', filename: 'ggml-tiny.bin' },
    { id: 'base', name: 'Base', filename: 'ggml-base.bin' },
    { id: 'small', name: 'Small', filename: 'ggml-small.bin' },
    { id: 'medium', name: 'Medium', filename: 'ggml-medium.bin' },
    { id: 'large-v3-turbo', name: 'Large V3 Turbo', filename: 'ggml-large-v3-turbo.bin' },
    { id: 'large-v3', name: 'Large V3', filename: 'ggml-large-v3.bin' },
    // High-accuracy quantized models
    { id: 'large-v3-turbo-q8_0', name: 'Large V3 Turbo Q8', filename: 'ggml-large-v3-turbo-q8_0.bin' },
    { id: 'large-v3-turbo-q5_0', name: 'Large V3 Turbo Q5', filename: 'ggml-large-v3-turbo-q5_0.bin' },
    { id: 'distil-large-v3', name: 'Distil Large V3', filename: 'ggml-distil-large-v3.bin' },
]

// ── Sherpa-ONNX Streaming ASR Models ───────────────────────────────────────
export const SHERPA_MODELS = [
    { id: 'sherpa-zipformer-en', name: 'English Zipformer', lang: 'en', dirName: 'sherpa-onnx-streaming-zipformer-en-2023-06-26', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2', size: '70MB' },
    { id: 'sherpa-zipformer-bilingual-zh-en', name: 'Chinese+English', lang: 'zh', dirName: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2', size: '70MB' },
    { id: 'sherpa-paraformer-zh', name: 'Chinese Paraformer', lang: 'zh', dirName: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2', size: '230MB' },
]

// ── NLLB Translation Models ─────────────────────────────────────────────────
export const NLLB_MODELS = [
    { id: 'nllb-200-distilled-600M', name: 'NLLB-200 Distilled 600M', hfRepo: 'Xenova/nllb-200-distilled-600M', size: '~800MB' },
]

export class ModelService {
    constructor() {
        this.setupHandlers()
    }

    // ── Directories ─────────────────────────────────────────────────────────
    private get whisperModelsDir(): string {
        return path.join(process.env.APP_ROOT || process.cwd(), 'bin', 'whisper.cpp', 'models')
    }

    private get sherpaModelsDir(): string {
        const userDataPath = app.getPath('userData')
        return path.join(userDataPath, 'models', 'sherpa-onnx')
    }

    private get nllbModelsDir(): string {
        const userDataPath = app.getPath('userData')
        return path.join(userDataPath, 'models', 'nllb')
    }

    // Keep backward compat
    private get modelsDir(): string {
        return this.whisperModelsDir
    }

    // ── IPC Handlers ────────────────────────────────────────────────────────
    setupHandlers() {
        // Whisper (existing)
        ipcMain.handle('get-downloaded-models', async () => {
            return this.scanModels()
        })
        ipcMain.handle('download-model', async (_, modelId: string) => {
            return this.downloadModel(modelId)
        })
        ipcMain.handle('delete-model', async (_, modelId: string) => {
            return this.deleteModel(modelId)
        })

        // Sherpa-ONNX
        ipcMain.handle('get-downloaded-sherpa-models', async () => {
            return this.scanSherpaModels()
        })
        ipcMain.handle('download-sherpa-model', async (_, modelId: string) => {
            return this.downloadSherpaModel(modelId)
        })
        ipcMain.handle('delete-sherpa-model', async (_, modelId: string) => {
            return this.deleteSherpaModel(modelId)
        })
        ipcMain.handle('get-sherpa-model-path', async (_, modelId: string) => {
            return this.getSherpaModelPath(modelId)
        })

        // NLLB
        ipcMain.handle('get-downloaded-nllb-models', async () => {
            return this.scanNllbModels()
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  WHISPER MODELS (existing, unchanged)
    // ═══════════════════════════════════════════════════════════════════════

    async scanModels() {
        try {
            if (!fs.existsSync(this.modelsDir)) {
                return []
            }
            const files = fs.readdirSync(this.modelsDir)
            return AVAILABLE_MODELS.filter(m => files.includes(m.filename)).map(m => m.id)
        } catch (error) {
            console.error('Failed to scan models:', error)
            return []
        }
    }

    downloadModel(modelId: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const scriptPath = path.join(this.modelsDir, 'download-ggml-model.sh')

            console.log(`Starting download for ${modelId}...`)

            const child = spawn('bash', [scriptPath, modelId], {
                cwd: this.modelsDir // Script expects to be run in its dir or provided a path
            })

            child.stdout.on('data', (data) => {
                console.log(`[Download ${modelId}]: ${data}`)
            })

            child.stderr.on('data', (data) => {
                console.error(`[Download ${modelId} ERR]: ${data}`)
            })

            child.on('close', (code) => {
                if (code === 0) {
                    console.log(`Download for ${modelId} completed successfully.`)
                    resolve(true)
                } else {
                    console.error(`Download for ${modelId} failed with code ${code}`)
                    reject(new Error(`Download process exited with code ${code}`))
                }
            })
        })
    }

    async deleteModel(modelId: string): Promise<boolean> {
        try {
            const model = AVAILABLE_MODELS.find(m => m.id === modelId)
            if (!model) throw new Error(`Unknown model: ${modelId}`)

            const modelPath = path.join(this.modelsDir, model.filename)
            if (fs.existsSync(modelPath)) {
                fs.unlinkSync(modelPath)
                console.log(`Deleted model: ${modelId}`)
                return true
            }
            return false
        } catch (error) {
            console.error(`Failed to delete model ${modelId}:`, error)
            throw error
        }
    }

    getModelPath(modelId: string): string {
        const model = AVAILABLE_MODELS.find(m => m.id === modelId)
        if (!model) throw new Error(`Unknown model: ${modelId}`)
        return path.join(this.modelsDir, model.filename)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  SHERPA-ONNX MODELS
    // ═══════════════════════════════════════════════════════════════════════

    async scanSherpaModels(): Promise<string[]> {
        try {
            if (!fs.existsSync(this.sherpaModelsDir)) {
                return []
            }
            const dirs = fs.readdirSync(this.sherpaModelsDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name)

            return SHERPA_MODELS.filter(m => dirs.includes(m.dirName)).map(m => m.id)
        } catch (error) {
            console.error('Failed to scan Sherpa-ONNX models:', error)
            return []
        }
    }

    async downloadSherpaModel(modelId: string): Promise<boolean> {
        const model = SHERPA_MODELS.find(m => m.id === modelId)
        if (!model) throw new Error(`Unknown Sherpa-ONNX model: ${modelId}`)

        if (!fs.existsSync(this.sherpaModelsDir)) {
            fs.mkdirSync(this.sherpaModelsDir, { recursive: true })
        }

        const archivePath = path.join(this.sherpaModelsDir, `${model.dirName}.tar.bz2`)
        console.log(`[Sherpa-ONNX] Downloading ${model.name} from ${model.url}...`)

        try {
            await this.downloadFile(model.url, archivePath)
            console.log(`[Sherpa-ONNX] Download complete, extracting...`)

            await new Promise<void>((resolve, reject) => {
                const child = spawn('tar', ['xjf', archivePath, '-C', this.sherpaModelsDir])
                child.on('close', (code) => {
                    if (code === 0) resolve()
                    else reject(new Error(`tar exited with code ${code}`))
                })
                child.on('error', reject)
            })

            if (fs.existsSync(archivePath)) {
                fs.unlinkSync(archivePath)
            }

            console.log(`[Sherpa-ONNX] Model ${model.name} installed successfully`)
            return true
        } catch (error) {
            if (fs.existsSync(archivePath)) {
                fs.unlinkSync(archivePath)
            }
            console.error(`[Sherpa-ONNX] Failed to download model ${modelId}:`, error)
            throw error
        }
    }

    async deleteSherpaModel(modelId: string): Promise<boolean> {
        const model = SHERPA_MODELS.find(m => m.id === modelId)
        if (!model) throw new Error(`Unknown Sherpa-ONNX model: ${modelId}`)

        const modelDir = path.join(this.sherpaModelsDir, model.dirName)
        if (fs.existsSync(modelDir)) {
            fs.rmSync(modelDir, { recursive: true, force: true })
            console.log(`[Sherpa-ONNX] Deleted model: ${modelId}`)
            return true
        }
        return false
    }

    getSherpaModelPath(modelId: string): string {
        const model = SHERPA_MODELS.find(m => m.id === modelId)
        if (!model) throw new Error(`Unknown Sherpa-ONNX model: ${modelId}`)
        return path.join(this.sherpaModelsDir, model.dirName)
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  NLLB MODELS (tracked, downloaded by transformers.js)
    // ═══════════════════════════════════════════════════════════════════════

    async scanNllbModels(): Promise<string[]> {
        try {
            // NLLB models are managed by transformers.js cache
            // We just check if the cache directory exists with model files
            if (!fs.existsSync(this.nllbModelsDir)) {
                return []
            }
            // Simple existence check — detailed validation in NllbTranslationService
            const contents = fs.readdirSync(this.nllbModelsDir)
            if (contents.length > 0) {
                return ['nllb-200-distilled-600M']
            }
            return []
        } catch (error) {
            console.error('Failed to scan NLLB models:', error)
            return []
        }
    }

    // ── Utility ─────────────────────────────────────────────────────────────

    private downloadFile(url: string, destPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath)
            const request = https.get(url, (response) => {
                // Handle redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const redirectUrl = response.headers.location
                    if (redirectUrl) {
                        file.close()
                        fs.unlinkSync(destPath)
                        return this.downloadFile(redirectUrl, destPath).then(resolve).catch(reject)
                    }
                }

                if (response.statusCode !== 200) {
                    file.close()
                    fs.unlinkSync(destPath)
                    reject(new Error(`HTTP ${response.statusCode}`))
                    return
                }

                response.pipe(file)
                file.on('finish', () => {
                    file.close()
                    resolve()
                })
            })

            request.on('error', (err) => {
                file.close()
                if (fs.existsSync(destPath)) {
                    fs.unlinkSync(destPath)
                }
                reject(err)
            })
        })
    }
}

