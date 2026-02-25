import { pipeline, env } from '@huggingface/transformers'

let translator: any = null
let isReady = false

// Standard Electron utilityProcess handler
process.parentPort.on('message', async (e: any) => {
    const msg = e.data
    if (msg.type === 'init') {
        const allowDownload = msg.payload.allowDownload
        const cacheDir = msg.payload.cacheDir

        try {
            env.cacheDir = cacheDir

            // Bypass onnxruntime-node entirely and force pure WASM execution 
            // This is the absolute cure for Exit Code 5 (Segmentation Fault in C++)
            env.allowLocalModels = true;
            if (env.backends?.onnx?.wasm) {
                // Prevent huggingface from trying to load the native ONNX bindings
                env.backends.onnx.wasm.numThreads = 1;
                env.backends.onnx.wasm.simd = false; // Core constraint for Macs
            }

            translator = await pipeline(
                'translation',
                'Xenova/nllb-200-distilled-600M',
                {
                    dtype: 'q8',
                    local_files_only: !allowDownload,
                    // Remove device: 'cpu' as it forces the EP array to reset
                }
            )
            isReady = true
            process.parentPort.postMessage({ type: 'init-success' })
        } catch (error: any) {
            process.parentPort.postMessage({ type: 'init-error', error: error.message || String(error) })
        }
    }
    else if (msg.type === 'translate') {
        if (!isReady || !translator) {
            process.parentPort.postMessage({ type: 'translate-error', error: 'Not ready', id: msg.id })
            return
        }

        const { text, srcLang, tgtLang, id } = msg.payload
        try {
            const result = await translator(text, {
                src_lang: srcLang,
                tgt_lang: tgtLang,
                max_new_tokens: 128,
                num_beams: 1,
                do_sample: false
            })

            const translatedText = result[0]?.translation_text || text
            process.parentPort.postMessage({ type: 'translate-success', id, translatedText })
        } catch (error: any) {
            process.parentPort.postMessage({ type: 'translate-error', id, error: error.message || String(error) })
        }
    }
})

process.on('uncaughtException', (err) => {
    console.error('NLLB Worker uncaughtException:', err)
})

process.on('unhandledRejection', (reason) => {
    console.error('NLLB Worker unhandledRejection:', reason)
})
