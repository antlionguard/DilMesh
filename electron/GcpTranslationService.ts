import { Translate } from '@google-cloud/translate/build/src/v2'

interface TranslationCache {
    [key: string]: {
        translation: string
        timestamp: number
    }
}

export class GcpTranslationService {
    private client: Translate | null = null
    private cache: TranslationCache = {}
    private readonly CACHE_TTL = 30000 // 30 seconds

    constructor() {
        // Client will be initialized when credentials are provided
    }

    /**
     * Initialize the translation client with GCP credentials
     */
    initialize(gcpKeyJson: string): boolean {
        try {
            if (gcpKeyJson) {
                const credentials = JSON.parse(gcpKeyJson)
                this.client = new Translate({ credentials })
                console.log('GCP Translation service initialized')
                return true
            } else {
                // Try default credentials
                this.client = new Translate()
                console.log('GCP Translation service initialized with default credentials')
                return true
            }
        } catch (error) {
            console.error('Failed to initialize GCP Translation service:', error)
            return false
        }
    }

    /**
     * Translate text to target language
     * @param text - Text to translate
     * @param targetLanguage - Target language code (e.g., 'en', 'tr')
     * @param sourceLanguage - Optional source language code
     * @returns Translated text, or original text if translation fails
     */
    async translate(
        text: string,
        targetLanguage: string,
        sourceLanguage?: string
    ): Promise<string> {
        // Return original text if no client
        if (!this.client) {
            console.warn('Translation client not initialized, returning original text')
            return text
        }

        // Return original if empty
        if (!text || text.trim().length === 0) {
            return text
        }

        // Check cache first
        const cacheKey = `${text}:${targetLanguage}:${sourceLanguage || 'auto'}`
        const cached = this.cache[cacheKey]
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.translation
        }

        try {
            const options: any = {
                to: targetLanguage.split('-')[0], // Extract language code (e.g. 'en-US' -> 'en')
            }

            if (sourceLanguage) {
                options.from = sourceLanguage.split('-')[0] // Extract language code (e.g. 'tr-TR' -> 'tr')
            }

            const [translation] = await this.client.translate(text, options)

            // Cache the result
            this.cache[cacheKey] = {
                translation,
                timestamp: Date.now(),
            }

            // Clean old cache entries periodically
            this.cleanCache()

            return translation
        } catch (error) {
            console.error('Translation failed:', error)
            // Fallback to original text on error
            return text
        }
    }

    /**
     * Clean expired cache entries
     */
    private cleanCache(): void {
        const now = Date.now()
        const keysToDelete: string[] = []

        for (const key in this.cache) {
            if (now - this.cache[key].timestamp > this.CACHE_TTL) {
                keysToDelete.push(key)
            }
        }

        keysToDelete.forEach((key) => delete this.cache[key])
    }

    /**
     * Clear all cached translations
     */
    clearCache(): void {
        this.cache = {}
    }

    /**
     * Check if translation service is ready
     */
    isReady(): boolean {
        return this.client !== null
    }
}
