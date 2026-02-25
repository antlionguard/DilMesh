<template>
  <div class="fixed inset-0 w-screen h-screen -z-10 transition-colors duration-300 draggable-region" 
       :style="{ backgroundColor: style.backgroundColor }">
  </div>
  <div 
    class="fixed transition-all duration-300 draggable-region" 
    :style="positionStyle"
  >
    <div class="text-center transition-all duration-300" :style="textStyle">
      {{ currentText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const currentText = ref('Waiting for subtitles...')

const style = ref({
  backgroundColor: '#00FF00',
  textColor: '#FFFFFF',
  fontSize: 48,
  fontFamily: 'Arial',
  textShadow: true,
  maxLines: 2,
  justifyContent: 'center',
  positionX: 50,
  positionY: 50
})

defineProps<{ id: string }>()

import { CSSProperties } from 'vue'

const positionStyle = computed((): CSSProperties => ({
  left: `${style.value.positionX}%`,
  top: `${style.value.positionY}%`,
  transform: 'translate(-50%, -50%)',
  width: '100vw',
  padding: '0 2vw',
  boxSizing: 'border-box',
  zIndex: 1000
}))

// @ts-ignore
const textStyle = computed((): CSSProperties => ({
  color: style.value.textColor,
  fontSize: `${style.value.fontSize}px`,
  fontFamily: style.value.fontFamily,
  textShadow: style.value.textShadow ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none',
  lineHeight: '1.2',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  maxHeight: style.value.maxLines > 0 ? `${style.value.fontSize * 1.2 * style.value.maxLines}px` : 'unset',
  overflow: 'hidden',
  overflowWrap: 'break-word',
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap'
} as CSSProperties))


onMounted(async () => {
  if (route.query.title) {
    document.title = `${route.query.title} - DilMesh`
  }

  // ── CPS Queue Player ────────────────────────────────────────────────────────
  // Translated sentences are queued and shown one at a time. Display duration
  // is calculated from character count using the Netflix-standard 17 CPS rate.
  // Live-caption windows skip the queue and show captions in real time.
  // ────────────────────────────────────────────────────────────────────────────

  let cps = 17               // Characters Per Second (default: Netflix standard)
  const MIN_DISPLAY_MS = 1500
  const MAX_DISPLAY_MS = 7000
  const INACTIVITY_CLEAR_MS = 10_000

  // Load settings on mount
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

  const sentenceQueue: { text: string, seq: number }[] = []
  let displayTimer: ReturnType<typeof setTimeout> | null = null
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null
  let isDisplaying = false
  let isTranslationMode = false

  // Query this window's language preference on mount (the language-mode-updated
  // event may have fired before this component mounted, so we need to check)
  try {
    const windowId = route.params.id as string
    if (windowId) {
      const lang = await window.ipcRenderer.invoke('get-window-language', { windowId })
      if (lang && lang !== 'live') {
        isTranslationMode = true
        currentText.value = ''  // clear "Waiting for subtitles..." placeholder
        console.log(`[Projection] Initialized in translation mode (${lang})`)
      }
    }
  } catch { /* fallback to live mode */ }

  // Hold timer for live mode is now handled via the queue — holdUntil removed.

  function calcHoldMs(text: string): number {
    return Math.min(Math.max((text.length / cps) * 1000, MIN_DISPLAY_MS), MAX_DISPLAY_MS)
  }

  function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(() => {
      currentText.value = ''
      isDisplaying = false
    }, INACTIVITY_CLEAR_MS)
  }

  function showNextFromQueue() {
    if (sentenceQueue.length === 0) {
      isDisplaying = false
      resetInactivityTimer()
      return
    }
    const entry = sentenceQueue.shift()!
    currentText.value = entry.text
    const holdMs = calcHoldMs(entry.text)
    console.log(`[Projection] Showing [seq=${entry.seq}] for ${holdMs}ms: "${entry.text.substring(0, 40)}..."`)
    displayTimer = setTimeout(showNextFromQueue, holdMs)
  }

  // Insert into queue maintaining seq order (handles async translation race)
  function insertOrdered(text: string, seq: number) {
    const entry = { text, seq }
    // Fast path: seq is higher than everything — just append
    if (sentenceQueue.length === 0 || seq > sentenceQueue[sentenceQueue.length - 1].seq) {
      sentenceQueue.push(entry)
    } else {
      // Find correct position via binary search
      let lo = 0, hi = sentenceQueue.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (sentenceQueue[mid].seq < seq) lo = mid + 1
        else hi = mid
      }
      sentenceQueue.splice(lo, 0, entry)
    }
  }

  // Listen for transcript updates from main process
  window.ipcRenderer.on('transcript-update', (_event, result: any) => {

    if (!isTranslationMode) {
      // ── LIVE MODE ──────────────────────────────────────────────────────────
      // Live windows show raw interim text in real-time. No queue, no CPS.
      // isSentence events are ignored — live mode is always showing the
      // latest interim so users see what's being said right now.
      if (!result.isSentence) {
        currentText.value = result.text
        resetInactivityTimer()
      }
      return
    }

    // ── TRANSLATION MODE ───────────────────────────────────────────────────
    // Translation windows ONLY process isSentence events.
    // These are punctuation-triggered clauses that have already been
    // translated in main.ts. They go into the CPS queue.
    if (!result.isSentence) return  // ignore interim completely

    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null }

    if (queueMaxDepth > 0 && sentenceQueue.length >= queueMaxDepth) {
      console.warn(`[Subtitle Queue] Max depth (${queueMaxDepth}) reached, dropping oldest sentence`)
      sentenceQueue.shift()
    }

    insertOrdered(result.text, result.seq ?? Date.now())

    if (!isDisplaying) {
      isDisplaying = true
      showNextFromQueue()
    }
  })

  // Listen for language mode changes from main process
  window.ipcRenderer.on('language-mode-updated', (_event, { language }: { language: string }) => {
    const wasTranslation = isTranslationMode
    isTranslationMode = language !== 'live'

    if (wasTranslation !== isTranslationMode) {
      // Clear queue and display when switching modes
      sentenceQueue.length = 0
      if (displayTimer) { clearTimeout(displayTimer); displayTimer = null }
      isDisplaying = false
      currentText.value = ''
    }
  })

  // Listen for style updates
  window.ipcRenderer.on('settings-updated', async (_event, settings: any) => {
    if (settings.style) {
      style.value = settings.style
    }
    if (settings.title) {
      document.title = `${settings.title} - DilMesh`
    }
    // Update queue depth and CPS live if settings change
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
  window.ipcRenderer.removeAllListeners('language-mode-updated')
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
