import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'

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

export class ModelService {
    constructor() {
        this.setupHandlers()
    }

    private get modelsDir(): string {
        return path.join(process.env.APP_ROOT || process.cwd(), 'bin', 'whisper.cpp', 'models')
    }

    setupHandlers() {
        ipcMain.handle('get-downloaded-models', async () => {
            return this.scanModels()
        })

        ipcMain.handle('download-model', async (_, modelId: string) => {
            return this.downloadModel(modelId)
        })

        ipcMain.handle('delete-model', async (_, modelId: string) => {
            return this.deleteModel(modelId)
        })
    }

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
}
