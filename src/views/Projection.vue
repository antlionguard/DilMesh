<template>
  <div class="fixed inset-0 w-screen h-screen -z-10 transition-colors duration-300 draggable-region" 
       :style="{ backgroundColor: sharedStyle.backgroundColor }">
  </div>
  <!-- Render one positioned div per language layer -->
  <div 
    v-for="layer in layers" 
    :key="layer.id"
    class="fixed transition-all duration-300 draggable-region" 
    :style="layerPositionStyle(layer)"
  >
    <div class="text-center transition-all duration-300" :style="layerTextStyle(layer)">
      {{ layerTexts[layer.id] || '' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'

import { CSSProperties } from 'vue'

interface LanguageLayer {
  id: string
  language: string
  positionX: number
  positionY: number
  fontSize: number
  fontFamily: string
  textColor: string
  maxLines: number
}

const route = useRoute()

// Shared style (background, shadow, alignment)
const sharedStyle = ref({
  backgroundColor: '#00FF00',
  textShadow: true,
  justifyContent: 'center'
})

// Language layers with their individual settings
const layers = ref<LanguageLayer[]>([])

// Reactive text content per layer (layerId → text)
const layerTexts = reactive<Record<string, string>>({})

defineProps<{ id: string }>()

const layerPositionStyle = (layer: LanguageLayer): CSSProperties => ({
  left: `${layer.positionX}%`,
  top: `${layer.positionY}%`,
  transform: 'translate(-50%, -50%)',
  width: '100vw',
  padding: '0 2vw',
  boxSizing: 'border-box',
  zIndex: 1000
})

// @ts-ignore
const layerTextStyle = (layer: LanguageLayer): CSSProperties => ({
  color: layer.textColor,
  fontSize: `${layer.fontSize}px`,
  fontFamily: layer.fontFamily,
  textShadow: sharedStyle.value.textShadow ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none',
  lineHeight: '1.2',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  maxHeight: layer.maxLines > 0 ? `${layer.fontSize * 1.2 * layer.maxLines}px` : 'unset',
  overflow: 'hidden',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap'
} as CSSProperties)


onMounted(async () => {
  if (route.query.title) {
    document.title = `${route.query.title} - DilMesh`
  }

  // ── CPS Queue Player — per-layer queues ──────────────────────────────────
  let cps = 17
  const MIN_DISPLAY_MS = 1500
  const MAX_DISPLAY_MS = 7000
  const INACTIVITY_CLEAR_MS = 10_000

  let queueMaxDepth = 0
  try {
    const s = await window.ipcRenderer.invoke('get-settings', 'transcription')
    if (s && typeof s.subtitleQueueMaxDepth === 'number') {
      queueMaxDepth = s.subtitleQueueMaxDepth
    }
    if (s && typeof s.subtitleCPS === 'number') {
      cps = s.subtitleCPS
    }
  } catch { /* settings not available yet, fall back to defaults */ }

  // Per-layer queue state
  interface LayerQueueState {
    sentenceQueue: { text: string, seq: number }[]
    displayTimer: ReturnType<typeof setTimeout> | null
    inactivityTimer: ReturnType<typeof setTimeout> | null
    isDisplaying: boolean
    isTranslationMode: boolean
  }

  const layerQueues = new Map<string, LayerQueueState>()

  function getOrCreateQueue(layerId: string, isTranslation: boolean): LayerQueueState {
    if (!layerQueues.has(layerId)) {
      layerQueues.set(layerId, {
        sentenceQueue: [],
        displayTimer: null,
        inactivityTimer: null,
        isDisplaying: false,
        isTranslationMode: isTranslation
      })
    }
    return layerQueues.get(layerId)!
  }

  // Initialize queues from current layers
  function initLayerQueues() {
    for (const layer of layers.value) {
      const isTranslation = layer.language !== 'live'
      getOrCreateQueue(layer.id, isTranslation)
      if (!isTranslation) {
        layerTexts[layer.id] = 'Waiting for subtitles...'
      } else {
        layerTexts[layer.id] = ''
      }
    }
  }

  // Query this window's language layers on mount
  try {
    const windowId = route.params.id as string
    if (windowId) {
      const windowLayers = await window.ipcRenderer.invoke('get-window-languages', { windowId })
      if (Array.isArray(windowLayers) && windowLayers.length > 0) {
        layers.value = windowLayers
        initLayerQueues()
        console.log(`[Projection] Initialized with ${windowLayers.length} language layers`)
      }
    }
  } catch { /* fallback */ }

  function calcHoldMs(text: string): number {
    return Math.min(Math.max((text.length / cps) * 1000, MIN_DISPLAY_MS), MAX_DISPLAY_MS)
  }

  function resetInactivityTimer(layerId: string) {
    const q = layerQueues.get(layerId)
    if (!q) return
    if (q.inactivityTimer) clearTimeout(q.inactivityTimer)
    q.inactivityTimer = setTimeout(() => {
      layerTexts[layerId] = ''
      q.isDisplaying = false
    }, INACTIVITY_CLEAR_MS)
  }

  function showNextFromQueue(layerId: string) {
    const q = layerQueues.get(layerId)
    if (!q) return
    if (q.sentenceQueue.length === 0) {
      q.isDisplaying = false
      resetInactivityTimer(layerId)
      return
    }
    const entry = q.sentenceQueue.shift()!
    layerTexts[layerId] = entry.text
    const holdMs = calcHoldMs(entry.text)
    console.log(`[Projection] Layer ${layerId} showing [seq=${entry.seq}] for ${holdMs}ms: "${entry.text.substring(0, 40)}..."`)
    q.displayTimer = setTimeout(() => showNextFromQueue(layerId), holdMs)
  }

  function insertOrdered(queue: { text: string, seq: number }[], text: string, seq: number) {
    const entry = { text, seq }
    if (queue.length === 0 || seq > queue[queue.length - 1].seq) {
      queue.push(entry)
    } else {
      let lo = 0, hi = queue.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (queue[mid].seq < seq) lo = mid + 1
        else hi = mid
      }
      queue.splice(lo, 0, entry)
    }
  }

  // Listen for transcript updates with layerId targeting
  window.ipcRenderer.on('transcript-update', (_event, result: any) => {
    const targetLayerId = result.layerId

    if (targetLayerId) {
      // Targeted to a specific layer
      const q = layerQueues.get(targetLayerId)
      if (!q) return

      if (!q.isTranslationMode) {
        // Live mode for this layer
        if (!result.isSentence) {
          layerTexts[targetLayerId] = result.text
          resetInactivityTimer(targetLayerId)
        }
        return
      }

      // Translation mode for this layer
      if (!result.isSentence) return

      if (q.inactivityTimer) { clearTimeout(q.inactivityTimer); q.inactivityTimer = null }

      if (queueMaxDepth > 0 && q.sentenceQueue.length >= queueMaxDepth) {
        q.sentenceQueue.shift()
      }

      insertOrdered(q.sentenceQueue, result.text, result.seq ?? Date.now())

      if (!q.isDisplaying) {
        q.isDisplaying = true
        showNextFromQueue(targetLayerId)
      }
    } else {
      // Legacy: no layerId — send to all layers based on their mode
      for (const [layerId, q] of layerQueues.entries()) {
        if (!q.isTranslationMode) {
          if (!result.isSentence) {
            layerTexts[layerId] = result.text
            resetInactivityTimer(layerId)
          }
        }
      }
    }
  })

  // Listen for language layers update from main process
  window.ipcRenderer.on('languages-updated', (_event, { languages }: { languages: LanguageLayer[] }) => {
    // Clear old queues
    for (const [, q] of layerQueues) {
      if (q.displayTimer) clearTimeout(q.displayTimer)
      if (q.inactivityTimer) clearTimeout(q.inactivityTimer)
    }
    layerQueues.clear()

    // Clear old texts
    for (const key of Object.keys(layerTexts)) {
      delete layerTexts[key]
    }

    layers.value = languages
    initLayerQueues()
  })

  // Listen for style updates
  window.ipcRenderer.on('settings-updated', async (_event, settings: any) => {
    if (settings.style) {
      sharedStyle.value = settings.style
    }
    if (settings.languages) {
      // Update layers with new settings from dashboard
      layers.value = settings.languages

      // Re-initialize queues for new layers
      const existingQueueIds = new Set(layerQueues.keys())
      for (const layer of layers.value) {
        if (!existingQueueIds.has(layer.id)) {
          const isTranslation = layer.language !== 'live'
          getOrCreateQueue(layer.id, isTranslation)
          layerTexts[layer.id] = isTranslation ? '' : 'Waiting for subtitles...'
        } else {
          // Update mode if language changed
          const q = layerQueues.get(layer.id)!
          const isTranslation = layer.language !== 'live'
          if (q.isTranslationMode !== isTranslation) {
            q.sentenceQueue.length = 0
            if (q.displayTimer) { clearTimeout(q.displayTimer); q.displayTimer = null }
            q.isDisplaying = false
            q.isTranslationMode = isTranslation
            layerTexts[layer.id] = ''
          }
        }
      }

      // Clean up removed layers
      for (const oldId of existingQueueIds) {
        if (!layers.value.find(l => l.id === oldId)) {
          const q = layerQueues.get(oldId)
          if (q) {
            if (q.displayTimer) clearTimeout(q.displayTimer)
            if (q.inactivityTimer) clearTimeout(q.inactivityTimer)
          }
          layerQueues.delete(oldId)
          delete layerTexts[oldId]
        }
      }
    }
    if (settings.title) {
      document.title = `${settings.title} - DilMesh`
    }
    if (typeof settings.subtitleQueueMaxDepth === 'number') {
      queueMaxDepth = settings.subtitleQueueMaxDepth
    }
    if (typeof settings.subtitleCPS === 'number') {
      cps = settings.subtitleCPS
    }
  })
})

onUnmounted(() => {
  window.ipcRenderer.removeAllListeners('transcript-update')
  window.ipcRenderer.removeAllListeners('settings-updated')
  window.ipcRenderer.removeAllListeners('languages-updated')
})
</script>


<style>
/* Reset default styles for this window to let user control everything */
html, body {
  background: transparent;
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
.draggable-region {
  -webkit-app-region: drag;
}
</style>
