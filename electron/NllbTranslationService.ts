import { app } from 'electron'
import { utilityProcess, UtilityProcess } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

// Needed to get dirname in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Translation cache
interface TranslationCache {
    [key: string]: string
}

export class NllbTranslationService {
    private worker: UtilityProcess | null = null
    private cache: TranslationCache = {}
    private isLoaded: boolean = false
    private isLoading: boolean = false
    private translateCallbacks: Map<string, { resolve: (val: string) => void, reject: (err: any) => void }> = new Map()
    private initCallback: { resolve: (val: boolean) => void, reject: (err: any) => void } | null = null

    // NLLB uses special language codes
    private static readonly LANG_MAP: Record<string, string> = {
        'en': 'eng_Latn',
        'tr': 'tur_Latn',
        'de': 'deu_Latn',
        'fr': 'fra_Latn',
        'es': 'spa_Latn',
        'it': 'ita_Latn',
        'pt': 'por_Latn',
        'ru': 'rus_Cyrl',
        'ja': 'jpn_Jpan',
        'ko': 'kor_Hang',
        'zh': 'zho_Hans',
        'ar': 'arb_Arab',
        'hi': 'hin_Deva',
        'nl': 'nld_Latn',
        'pl': 'pol_Latn',
        'sv': 'swe_Latn',
        'uk': 'ukr_Cyrl',
    }

    private get cacheDir(): string {
        return path.join(app.getPath('userData'), 'models', 'nllb')
    }

    async initialize(allowDownload: boolean = false): Promise<boolean> {
        if (this.isLoaded) return true
        if (this.isLoading) return false

        this.isLoading = true

        return new Promise((resolve, reject) => {
            try {
                const workerPath = path.join(__dirname, 'nllbWorker.js')
                this.worker = utilityProcess.fork(workerPath, [], {
                    execArgv: ['--max-old-space-size=8192'], // 8GB heap limit to prevent V8 code 5 OOM crashes
                    stdio: 'pipe'
                })

                this.worker.stdout?.on('data', (data) => console.log(`[NLLB Worker STDOUT]: ${data.toString()}`))
                this.worker.stderr?.on('data', (data) => console.error(`[NLLB Worker STDERR]: ${data.toString()}`))

                this.worker.on('message', (msg: any) => {
                    if (msg.type === 'init-success') {
                        this.isLoaded = true
                        this.isLoading = false
                        console.log('[NLLB] Translation model loaded successfully in Worker')
                        if (this.initCallback) {
                            this.initCallback.resolve(true)
                            this.initCallback = null
                        }
                    } else if (msg.type === 'init-error') {
                        console.error('[NLLB] Failed to load model in worker:', msg.error)
                        this.isLoaded = false
                        this.isLoading = false
                        if (this.initCallback) {
                            this.initCallback.resolve(false)
                            this.initCallback = null
                        }
                    } else if (msg.type === 'translate-success') {
                        const cb = this.translateCallbacks.get(msg.id)
                        if (cb) {
                            cb.resolve(msg.translatedText)
                            this.translateCallbacks.delete(msg.id)
                        }
                    } else if (msg.type === 'translate-error') {
                        const cb = this.translateCallbacks.get(msg.id)
                        if (cb) {
                            cb.reject(new Error(msg.error))
                            this.translateCallbacks.delete(msg.id)
                        }
                    }
                })

                this.worker.on('exit', (code) => {
                    console.log(`[NLLB Worker] exited with code ${code}`)
                    this.isLoaded = false
                    this.isLoading = false
                    this.worker = null
                })

                this.initCallback = { resolve, reject }

                console.log(`[NLLB] Sending init command to worker (allowDownload: ${allowDownload})...`)
                this.worker.postMessage({
                    type: 'init',
                    payload: { allowDownload, cacheDir: this.cacheDir }
                })

            } catch (error) {
                console.error('[NLLB] Failed to start worker:', error)
                this.isLoaded = false
                this.isLoading = false
                resolve(false)
            }
        })
    }

    async translate(
        text: string,
        targetLanguage: string,
        sourceLanguage?: string
    ): Promise<string> {
        if (!this.isLoaded || !this.worker) {
            throw new Error('NLLB model not loaded. Call initialize() first.')
        }

        const cacheKey = `${sourceLanguage || 'auto'}:${targetLanguage}:${text}`
        if (this.cache[cacheKey]) {
            return this.cache[cacheKey]
        }

        const srcLang = sourceLanguage ? NllbTranslationService.toNllbCode(sourceLanguage) : 'eng_Latn'
        const tgtLang = NllbTranslationService.toNllbCode(targetLanguage)

        // DEBUG
        console.log(`[NLLB] Job dispatched to worker: "${text}" | src: ${srcLang} -> tgt: ${tgtLang}`)

        return new Promise<string>((resolve) => {
            const id = Math.random().toString(36).substring(7)

            this.translateCallbacks.set(id, {
                resolve: (translatedText: string) => {
                    this.cache[cacheKey] = translatedText
                    resolve(translatedText)
                },
                reject: (err: any) => {
                    console.error('[NLLB Worker Error]', err)
                    resolve(text) // fallback to original text
                }
            })

            this.worker!.postMessage({
                type: 'translate',
                payload: { text, srcLang, tgtLang, id }
            })
        })
    }

    isReady(): boolean {
        return this.isLoaded
    }

    clearCache(): void {
        this.cache = {}
    }

    cleanCache(maxSize: number = 1000): void {
        const keys = Object.keys(this.cache)
        if (keys.length > maxSize) {
            const removeCount = keys.length - maxSize
            for (let i = 0; i < removeCount; i++) {
                delete this.cache[keys[i]]
            }
        }
    }

    /**
     * Convert short language code to NLLB format.
     */
    static toNllbCode(langCode: string): string {
        if (!langCode) return 'eng_Latn'
        // Strip region codes (e.g., "tr-TR" -> "tr")
        const baseCode = langCode.split('-')[0].toLowerCase()
        return NllbTranslationService.LANG_MAP[baseCode] || langCode
    }

    async destroy(): Promise<void> {
        if (this.worker) {
            this.worker.kill()
            this.worker = null
        }
        this.isLoaded = false
        this.cache = {}
        console.log('[NLLB] Worker Destroyed')
    }
}
