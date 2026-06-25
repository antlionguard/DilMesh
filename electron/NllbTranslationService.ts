import { app } from 'electron'
import { utilityProcess, UtilityProcess } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { store } from './store'

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
    private translateCallbacks: Map<string, { resolve: (val: string) => void, reject: (err: any) => void }> = new Map()
    private initCallback: { resolve: (val: boolean) => void, reject: (err: any) => void } | null = null
    private initPromise: Promise<boolean> | null = null
    private lastFailTime: number = 0
    private loadedModelId: string | null = null
    private static readonly RETRY_COOLDOWN_MS = 30000  // after a failed load, don't churn re-init for this long
    private static readonly DEFAULT_MODEL = 'Xenova/nllb-200-distilled-600M'

    private getModelId(): string {
        try {
            const s: any = store.get('transcription')
            if (typeof s?.nllbModelId === 'string' && s.nllbModelId) return s.nllbModelId
        } catch { /* default */ }
        return NllbTranslationService.DEFAULT_MODEL
    }

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
        const modelId = this.getModelId()
        if (this.isLoaded && this.loadedModelId === modelId) return true
        // Share the in-flight init so concurrent callers await the same load
        if (this.initPromise) return this.initPromise
        // Model changed since last load → tear down the old worker first
        if (this.isLoaded && this.loadedModelId !== modelId) {
            await this.destroy()
        }
        this.initPromise = this.startWorker(allowDownload, modelId).finally(() => { this.initPromise = null })
        return this.initPromise
    }

    private startWorker(allowDownload: boolean, modelId: string): Promise<boolean> {
        return new Promise((resolve) => {
            // Resolve the init promise at most once, and never reject (callers treat false as "not ready")
            const settleInit = (ok: boolean) => {
                if (this.initCallback) {
                    this.initCallback = null
                    if (!ok) this.lastFailTime = Date.now()
                    resolve(ok)
                }
            }

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
                        this.loadedModelId = modelId
                        this.lastFailTime = 0
                        console.log(`[NLLB] Model "${modelId}" loaded successfully in Worker`)
                        settleInit(true)
                    } else if (msg.type === 'init-error') {
                        console.error('[NLLB] Failed to load model in worker:', msg.error)
                        this.isLoaded = false
                        settleInit(false)
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
                    const wasLoaded = this.isLoaded
                    this.isLoaded = false
                    this.worker = null
                    // An exit during/after init is a failure — settle init and reject any in-flight translations
                    if (wasLoaded || code !== 0) this.lastFailTime = Date.now()
                    settleInit(false)
                    for (const [, cb] of this.translateCallbacks) {
                        cb.reject(new Error(`NLLB worker exited (code ${code})`))
                    }
                    this.translateCallbacks.clear()
                })

                this.initCallback = { resolve: () => settleInit(true), reject: () => settleInit(false) }

                console.log(`[NLLB] Sending init command to worker (model: ${modelId}, allowDownload: ${allowDownload})...`)
                this.worker.postMessage({
                    type: 'init',
                    payload: { allowDownload, cacheDir: this.cacheDir, modelId }
                })

            } catch (error) {
                console.error('[NLLB] Failed to start worker:', error)
                this.isLoaded = false
                settleInit(false)
            }
        })
    }

    async translate(
        text: string,
        targetLanguage: string,
        sourceLanguage?: string
    ): Promise<string> {
        if (!text || !text.trim()) return text

        // Self-heal: the worker may have crashed (V8 OOM / segfault). Try a lazy reload
        // from the local cache, unless we failed very recently (avoid re-fork churn).
        if (!this.isLoaded || !this.worker) {
            if (Date.now() - this.lastFailTime < NllbTranslationService.RETRY_COOLDOWN_MS) {
                return text // recently failed — fall back to original without thrashing
            }
            console.log('[NLLB] Worker not ready — attempting lazy (re)load from cache')
            const ok = await this.initialize(false)
            if (!ok || !this.worker) return text // still not ready — fall back to original
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

            // Beam search count (quality vs speed) is read live from settings
            let numBeams = 5
            try {
                const s: any = store.get('transcription')
                if (typeof s?.nllbNumBeams === 'number') numBeams = s.nllbNumBeams
            } catch { /* default */ }

            this.worker!.postMessage({
                type: 'translate',
                payload: { text, srcLang, tgtLang, id, numBeams }
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
        this.loadedModelId = null
        this.cache = {}
        console.log('[NLLB] Worker Destroyed')
    }
}
