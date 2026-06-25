import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { pathToFileURL, fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

let translator: any = null
let isReady = false
let currentCacheDir = ''   // set on init; used to persist HF downloads to disk

// The transformers.js WEB build loads model files via fetch() (browser style):
//  - file:// URLs (local models) → read from disk (Node fetch can't do file://)
//  - https HuggingFace URLs (downloads) → pass through, but TEE the bytes to disk so
//    the model persists for offline use (the web build otherwise never writes to fs).
const realFetch = globalThis.fetch?.bind(globalThis)
globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input))

    if (url.startsWith('file:')) {
        try {
            const filePath = fileURLToPath(url)
            const buf = await fs.promises.readFile(filePath)
            return new Response(buf, {
                status: 200,
                headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.length) },
            })
        } catch (err: any) {
            return new Response(null, { status: 404, statusText: String(err?.message || err) })
        }
    }

    const res = await realFetch!(input, init)

    // Persist HuggingFace model downloads to the local cache (offline reuse)
    const hf = currentCacheDir && res.ok && res.body
        ? url.match(/huggingface\.co\/(.+?)\/resolve\/[^/]+\/(.+?)(?:\?|$)/)
        : null
    if (hf && res.body) {
        try {
            const dest = path.join(currentCacheDir, hf[1], decodeURIComponent(hf[2]))
            await fs.promises.mkdir(path.dirname(dest), { recursive: true })
            const [toDisk, toCaller] = res.body.tee()
            const tmp = dest + '.download'
            const ws = fs.createWriteStream(tmp)
            Readable.fromWeb(toDisk as any).pipe(ws)
            ws.on('finish', () => { fs.promises.rename(tmp, dest).catch(() => {}) })
            ws.on('error', () => { try { fs.unlinkSync(tmp) } catch { /* ignore */ } })
            console.log(`[NLLB] Caching download → ${dest}`)
            return new Response(toCaller as any, { status: res.status, statusText: res.statusText, headers: res.headers })
        } catch (e) {
            console.error('[NLLB] Failed to tee download to disk:', e)
            return res
        }
    }
    return res
}) as typeof fetch

// Load the WEB (WASM) build of transformers.js explicitly. The default Node build
// pulls in native `onnxruntime-node`, which segfaults (exit code 5) inside an
// Electron utilityProcess. The web build uses onnxruntime-web (pure WASM) instead.
async function loadWebTransformers(): Promise<{ pipeline: any; env: any; ortDistDir: string }> {
    const nodeEntry = require.resolve('@huggingface/transformers') // .../dist/transformers.node.(c|m)js
    const distDir = path.dirname(nodeEntry)
    const webEntry = path.join(distDir, 'transformers.web.js')

    // onnxruntime-web ships its own WASM glue (ort-wasm-simd-threaded.mjs) + .wasm; ort
    // imports the glue relative to wasm paths, so we must point at ITS dist, not transformers'.
    let ortDistDir = distDir
    try {
        const tfRequire = createRequire(nodeEntry)
        ortDistDir = path.dirname(tfRequire.resolve('onnxruntime-web'))
    } catch { /* fall back to transformers dist */ }

    // Force the web build down its WASM path. If it detects a Node environment it (a)
    // selects native onnxruntime-node (bundled as "ignored" → crash) and (b) leaves the
    // supported-device list empty so device resolution throws. By making IS_NODE_ENV
    // evaluate false at import time, it instead uses onnxruntime-web (Node WASM build,
    // ort.node.min.mjs) and registers supportedDevices=['wasm'].
    const origRelease = process.release
    try {
        Object.defineProperty(process, 'release', {
            value: { ...(origRelease || {}), name: 'electron-utility' },
            configurable: true,
        })
        const mod: any = await import(pathToFileURL(webEntry).href)
        return { pipeline: mod.pipeline, env: mod.env, ortDistDir }
    } finally {
        Object.defineProperty(process, 'release', { value: origRelease, configurable: true })
    }
}

process.parentPort.on('message', async (e: any) => {
    const msg = e.data
    if (msg.type === 'init') {
        const allowDownload = msg.payload.allowDownload
        const cacheDir = msg.payload.cacheDir
        const modelId = msg.payload.modelId || 'Xenova/nllb-200-distilled-600M'
        currentCacheDir = cacheDir

        try {
            const { pipeline, env, ortDistDir } = await loadWebTransformers()

            // The web build resolves local models against env.localModelPath as a URL.
            // Give it a file:// base so paths parse, and the fetch shim above reads them from disk.
            env.allowLocalModels = true
            env.allowRemoteModels = allowDownload   // only reach the network when explicitly downloading
            env.cacheDir = cacheDir
            env.localModelPath = pathToFileURL(cacheDir.endsWith(path.sep) ? cacheDir : cacheDir + path.sep).href

            // Point onnxruntime-web at its OWN dist (where the WASM glue + .wasm live) and
            // run single-threaded (no nested workers in the utilityProcess). The glue loads
            // the .wasm via file:// which the fetch shim above serves from disk (offline).
            if (env.backends?.onnx?.wasm) {
                env.backends.onnx.wasm.numThreads = 1
                env.backends.onnx.wasm.wasmPaths = pathToFileURL(ortDistDir.endsWith(path.sep) ? ortDistDir : ortDistDir + path.sep).href
            }

            console.log(`[NLLB] Loading model "${modelId}" (allowDownload: ${allowDownload})`)
            translator = await pipeline(
                'translation',
                modelId,
                {
                    dtype: 'q8',
                    device: 'wasm',
                    local_files_only: !allowDownload,
                }
            )
            isReady = true
            process.parentPort.postMessage({ type: 'init-success' })
        } catch (error: any) {
            process.parentPort.postMessage({ type: 'init-error', error: error?.stack || error?.message || String(error) })
        }
    }
    else if (msg.type === 'translate') {
        const id = msg.payload?.id
        if (!isReady || !translator) {
            process.parentPort.postMessage({ type: 'translate-error', error: 'Not ready', id })
            return
        }

        const { text, srcLang, tgtLang, numBeams } = msg.payload
        try {
            const beams = Math.max(1, Math.min(8, numBeams || 5))
            const result = await translator(text, {
                src_lang: srcLang,
                tgt_lang: tgtLang,
                max_new_tokens: 128,
                num_beams: beams,
                do_sample: false,
                early_stopping: beams > 1,
            })

            const translatedText = result[0]?.translation_text || text
            process.parentPort.postMessage({ type: 'translate-success', id, translatedText })
        } catch (error: any) {
            process.parentPort.postMessage({ type: 'translate-error', id, error: error?.message || String(error) })
        }
    }
})

process.on('uncaughtException', (err) => {
    console.error('NLLB Worker uncaughtException:', err)
})

process.on('unhandledRejection', (reason) => {
    console.error('NLLB Worker unhandledRejection:', reason)
})
