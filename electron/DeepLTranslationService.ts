interface TranslationCache {
  [key: string]: {
    translation: string
    timestamp: number
  }
}

/**
 * DeepL translation via the REST API (uses Node's global fetch — no extra deps).
 * Free keys (suffix ":fx") hit api-free.deepl.com; Pro keys hit api.deepl.com.
 */
export class DeepLTranslationService {
  private apiKey: string | null = null
  private apiUrl = ''
  private cache: TranslationCache = {}
  private readonly CACHE_TTL = 30000 // 30 seconds

  // Concurrency limiter — many layers translate in parallel, but DeepL (especially the
  // free tier) rate-limits bursts. Cap in-flight requests and queue the rest.
  private readonly maxConcurrent = 4
  private active = 0
  private waiters: Array<() => void> = []

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) { this.active++; return }
    await new Promise<void>(resolve => this.waiters.push(resolve))
    // slot handed over directly by release() — already counted in `active`
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) next()        // transfer the slot to the next waiter (active unchanged)
    else this.active--      // no one waiting — free the slot
  }

  initialize(apiKey: string, apiUrlOverride?: string): boolean {
    if (!apiKey || !apiKey.trim()) {
      this.apiKey = null
      console.warn('DeepL: no API key provided')
      return false
    }
    this.apiKey = apiKey.trim()
    if (apiUrlOverride && apiUrlOverride.trim()) {
      this.apiUrl = apiUrlOverride.trim().replace(/\/$/, '')
    } else {
      // Free-tier keys end with ":fx"
      const isFree = this.apiKey.endsWith(':fx')
      this.apiUrl = isFree ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
    }
    console.log(`DeepL Translation service initialized (${this.apiUrl})`)
    return true
  }

  isReady(): boolean {
    return this.apiKey !== null
  }

  /**
   * Translate text. Returns the original text on any failure (unsupported
   * language, network error, etc.) so the caption pipeline never breaks.
   */
  async translate(text: string, targetLanguage: string, sourceLanguage?: string): Promise<string> {
    if (!this.apiKey) return text
    if (!text || text.trim().length === 0) return text

    const cacheKey = `${text}:${targetLanguage}:${sourceLanguage || 'auto'}`
    const cached = this.cache[cacheKey]
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.translation
    }

    const target = DeepLTranslationService.toTargetLang(targetLanguage)
    if (!target) return text // unsupported target — keep original

    const body = new URLSearchParams()
    body.append('text', text)
    body.append('target_lang', target)
    const source = DeepLTranslationService.toSourceLang(sourceLanguage)
    if (source) body.append('source_lang', source)
    const payload = body.toString()

    await this.acquire()
    try {
      const maxAttempts = 3
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetch(`${this.apiUrl}/v2/translate`, {
            method: 'POST',
            headers: {
              'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: payload,
          })

          if (res.ok) {
            const data: any = await res.json()
            const translation: string = data?.translations?.[0]?.text ?? text
            this.cache[cacheKey] = { translation, timestamp: Date.now() }
            this.cleanCache()
            return translation
          }

          // 429 (too many requests) / 529 (under load) → transient: retry with backoff
          if ((res.status === 429 || res.status === 529) && attempt < maxAttempts) {
            const waitMs = 400 * attempt
            console.warn(`DeepL ${res.status} — retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`)
            await new Promise(r => setTimeout(r, waitMs))
            continue
          }

          // Non-retryable (456 quota exceeded, 403 auth, …) or out of retries → keep original
          console.error(`DeepL translate failed: HTTP ${res.status} ${await res.text().catch(() => '')}`)
          return text
        } catch (error) {
          if (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 400 * attempt))
            continue
          }
          console.error('DeepL translation error:', error)
          return text
        }
      }
      return text
    } finally {
      this.release()
    }
  }

  // Map our lowercase ISO codes to DeepL target language codes (uppercase, some regional).
  static toTargetLang(code: string): string | null {
    const base = (code || '').split('-')[0].toLowerCase()
    const full = (code || '').toLowerCase()
    const map: Record<string, string> = {
      en: 'EN-US', pt: 'PT-PT', no: 'NB',
      bg: 'BG', cs: 'CS', da: 'DA', de: 'DE', el: 'EL', es: 'ES', et: 'ET',
      fi: 'FI', fr: 'FR', hu: 'HU', id: 'ID', it: 'IT', ja: 'JA', ko: 'KO',
      lt: 'LT', lv: 'LV', nl: 'NL', pl: 'PL', ro: 'RO', ru: 'RU', sk: 'SK',
      sl: 'SL', sv: 'SV', tr: 'TR', uk: 'UK', ar: 'AR',
    }
    if (full === 'zh-tw' || full === 'zh-hk') return 'ZH-HANT'
    if (base === 'zh') return 'ZH-HANS'
    return map[base] ?? null
  }

  // DeepL source_lang uses base codes; return null for 'auto'/unknown to let DeepL detect.
  static toSourceLang(code?: string): string | null {
    if (!code) return null
    const base = code.split('-')[0].toLowerCase()
    if (base === 'auto' || base === 'live' || base === '') return null
    if (base === 'zh') return 'ZH'
    const map: Record<string, string> = {
      en: 'EN', pt: 'PT', no: 'NB',
      bg: 'BG', cs: 'CS', da: 'DA', de: 'DE', el: 'EL', es: 'ES', et: 'ET',
      fi: 'FI', fr: 'FR', hu: 'HU', id: 'ID', it: 'IT', ja: 'JA', ko: 'KO',
      lt: 'LT', lv: 'LV', nl: 'NL', pl: 'PL', ro: 'RO', ru: 'RU', sk: 'SK',
      sl: 'SL', sv: 'SV', tr: 'TR', uk: 'UK', ar: 'AR',
    }
    return map[base] ?? null
  }

  private cleanCache(): void {
    const now = Date.now()
    for (const key in this.cache) {
      if (now - this.cache[key].timestamp > this.CACHE_TTL) delete this.cache[key]
    }
  }

  clearCache(): void {
    this.cache = {}
  }
}
