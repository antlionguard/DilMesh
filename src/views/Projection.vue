<template>
  <div class="fixed inset-0 w-screen h-screen -z-10 transition-colors duration-300 draggable-region" 
       :style="{ backgroundColor: style.backgroundColor }"
       @contextmenu.prevent="onContextMenu">
  </div>
  <div 
    class="fixed transition-all duration-300 draggable-region" 
    :style="positionStyle"
    @contextmenu.prevent="onContextMenu"
  >
    <div class="text-center transition-all duration-300" :style="textStyle">
      {{ currentText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const currentText = ref('Waiting for subtitles...')

const style = ref({
  backgroundColor: '#00FF00',
  textColor: '#FFFFFF',
  fontSize: 48,
  fontFamily: 'Arial',
  textShadow: true,
  maxLines: 2,
  justifyContent: 'center',
  positionX: 50,  // Center by default
  positionY: 50   // Center by default
})

const props = defineProps<{ id: string }>()

const onContextMenu = () => {
   window.ipcRenderer.invoke('show-context-menu', { id: props.id })
}

import { CSSProperties } from 'vue'

const positionStyle = computed((): CSSProperties => ({
  left: `${style.value.positionX}%`,
  top: `${style.value.positionY}%`,
  transform: 'translate(-50%, -50%)',
  maxWidth: '90vw',
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
  // Listen for transcript updates from main process (centralized)
  window.ipcRenderer.on('transcript-update', (_event, result: any) => {
    currentText.value = result.text
  })

  // Listen for style updates
  window.ipcRenderer.on('settings-updated', async (_event, settings: any) => {
    if (settings.style) {
      style.value = settings.style
    }
  })
})

onUnmounted(() => {
  // Cleanup IPC listeners
  window.ipcRenderer.removeAllListeners('transcript-update')
  window.ipcRenderer.removeAllListeners('settings-updated')
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
