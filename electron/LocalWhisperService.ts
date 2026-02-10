import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { EventEmitter } from 'events'
import fs from 'fs'

export class LocalWhisperService extends EventEmitter {
    private process: ChildProcess | null = null
    private isRunning = false
    private modelPath: string
    private binaryPath: string

    constructor() {
        super()
        // TODO: Handle production path
        const rootDir = process.env.APP_ROOT || process.cwd()
        this.binaryPath = path.join(rootDir, 'bin', 'whisper.cpp', 'build', 'bin', 'whisper-stream')
        // Using SMALL model for better accuracy (User request)
        this.modelPath = path.join(rootDir, 'bin', 'whisper.cpp', 'models', 'ggml-small.bin')
    }

    start(deviceId: number, language: string = 'auto', model: string = 'small', settings?: any) {
        if (this.isRunning) return

        // Resolve model path dynamically
        const rootDir = process.env.APP_ROOT || process.cwd()
        this.modelPath = path.join(rootDir, 'bin', 'whisper.cpp', 'models', `ggml-${model}.bin`)

        console.log('Starting Local Whisper Service...')
        console.log('Binary:', this.binaryPath)
        console.log('Model:', this.modelPath)
        console.log('Language:', language)

        if (!fs.existsSync(this.binaryPath)) {
            console.error('Binary not found:', this.binaryPath)
            return
        }

        if (!fs.existsSync(this.modelPath)) {
            this.emit('error', `Model not found at ${this.modelPath}`)
            return
        }

        // Use settings or defaults
        const step = settings?.step || 1000
        const length = settings?.length || 5000
        const keep = settings?.keep || 400
        const beamSize = settings?.beamSize || 5
        const vth = settings?.vth || 0.7

        // Arguments for whisper-stream (Optimized for stability)
        const args = [
            '-m', this.modelPath,
            '-c', deviceId.toString(),
            '-t', '4',                    // Threads
            '--step', step.toString(),
            '--length', length.toString(),
            '--keep', keep.toString(),
            '--beam-size', beamSize.toString(),
            '--no-fallback',              // Disable temperature fallback (deterministic)
            '-vth', vth.toString(),
            '-l', language                // Language
        ]

        this.process = spawn(this.binaryPath, args)
        this.isRunning = true

        this.process.stdout?.on('data', (data) => {
            let text = data.toString()

            // 1. Strip ANSI escape codes (Fixes [2K issues)
            // eslint-disable-next-line no-control-regex
            text = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

            // 2. Filter out non-speech patterns (e.g., [BLANK_AUDIO], (keyboard clicking))
            text = text.replace(/\[.*?\]/g, '')
            text = text.replace(/\(.*?\)/g, '')

            // 3. Cleanup whitespace
            text = text.trim()

            // Only emit if there's actual text
            if (text.length > 0) {
                console.log('Whisper clean:', text)
                this.emit('transcription', text)
            }
        })

        this.process.stderr?.on('data', (data) => {
            console.error('Whisper stderr:', data.toString())
        })

        this.process.on('close', (code) => {
            console.log(`Whisper process exited with code ${code}`)
            this.isRunning = false
            this.process = null
            this.emit('stop')
        })
    }

    stop() {
        if (this.process) {
            this.process.kill()
            this.process = null
            this.isRunning = false
        }
    }
}
