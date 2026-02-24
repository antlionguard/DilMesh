import { app } from 'electron'
import path from 'path'

// Translation cache
interface TranslationCache {
    [key: string]: string
}

/**
 * NllbTranslationService provides offline text-to-text translation using
 * Meta's NLLB-200 model via @huggingface/transformers (Transformers.js).
 *
 * Model: Xenova/nllb-200-distilled-600M (ONNX quantized, ~600MB-1.2GB)
 * Languages: 200+ (including Turkish: tur_Latn, English: eng_Latn)
 *
 * Same interface as GcpTranslationService:
 * - initialize() → load model (downloads on first use, caches locally)
 * - translate(text, targetLang, sourceLang?) → translated text
 * - isReady() → boolean
 * - clearCache()
 *
 * NLLB language codes use BCP-47 + script format: eng_Latn, tur_Latn, deu_Latn, etc.
 */
export class NllbTranslationService {
    private translator: any = null
    private cache: TranslationCache = {}
    private isLoaded: boolean = false
    private isLoading: boolean = false

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

    /**
     * Initialize the translation pipeline.
     * Downloads the model on first use (~600MB-1.2GB), then caches locally.
     */
    async initialize(): Promise<boolean> {
        if (this.isLoaded) return true
        if (this.isLoading) return false

        this.isLoading = true

        try {
            // Dynamic import for ESM module
            const { pipeline, env } = await import('@huggingface/transformers')

            // Configure cache directory
            env.cacheDir = this.cacheDir

            console.log('[NLLB] Loading translation model (first time may take a while to download)...')

            this.translator = await pipeline(
                'translation',
                'Xenova/nllb-200-distilled-600M',
                {
                    // Use quantized model for faster loading
                    dtype: 'q8',
                }
            )

            this.isLoaded = true
            this.isLoading = false
            console.log('[NLLB] Translation model loaded successfully')
            return true
        } catch (error) {
            console.error('[NLLB] Failed to load model:', error)
            this.isLoaded = false
            this.isLoading = false
            return false
        }
    }

    /**
     * Translate text.
     *
     * @param text - Text to translate
     * @param targetLanguage - Target language (short code: 'en', 'tr', etc.)
     * @param sourceLanguage - Source language (optional, auto-detect if omitted)
     */
    async translate(
        text: string,
        targetLanguage: string,
        sourceLanguage?: string
    ): Promise<string> {
        if (!this.isLoaded || !this.translator) {
            throw new Error('NLLB model not loaded. Call initialize() first.')
        }

        // Check cache
        const cacheKey = `${sourceLanguage || 'auto'}:${targetLanguage}:${text}`
        if (this.cache[cacheKey]) {
            return this.cache[cacheKey]
        }

        try {
            const srcLang = sourceLanguage
                ? NllbTranslationService.LANG_MAP[sourceLanguage] || sourceLanguage
                : 'eng_Latn'
            const tgtLang = NllbTranslationService.LANG_MAP[targetLanguage] || targetLanguage

            const result = await this.translator(text, {
                src_lang: srcLang,
                tgt_lang: tgtLang,
            })

            const translatedText = result[0]?.translation_text || text

            // Cache result
            this.cache[cacheKey] = translatedText

            return translatedText
        } catch (error) {
            console.error('[NLLB] Translation error:', error)
            return text  // Return original text on error
        }
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
        return NllbTranslationService.LANG_MAP[langCode] || langCode
    }

    async destroy(): Promise<void> {
        this.translator = null
        this.isLoaded = false
        this.cache = {}
        console.log('[NLLB] Destroyed')
    }
}
