<template>
  <div class="h-full bg-gray-900 text-white p-6 flex flex-col overflow-hidden">
    <header class="mb-4 flex-none flex justify-between items-center gap-4">
      <h1 class="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
        Dashboard
      </h1>
      
      <!-- VU Meter -->
      <div class="flex-1 max-w-md">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-400 w-12">MIC</span>
          <div class="flex-1 h-6 bg-gray-800 rounded-full overflow-hidden border border-gray-700">
            <div 
              class="h-full transition-all duration-75 ease-out"
              :style="{
                width: `${audioLevel}%`,
                background: audioLevel > 80 ? 'linear-gradient(90deg, #10b981, #ef4444)' : 
                           audioLevel > 50 ? 'linear-gradient(90deg, #10b981, #f59e0b)' : 
                           'linear-gradient(90deg, #10b981, #10b981)'
              }"
            ></div>
          </div>
          <span class="text-xs text-gray-400 w-8 text-right">{{ Math.round(audioLevel) }}</span>
        </div>
      </div>
      
      <div class="flex gap-2">
        <button 
          @click="toggleTranscription" 
          :class="isTranscribing ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'"
          class="text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2 font-medium"
        >
          <span>{{ isTranscribing ? '⏸️' : '▶️' }}</span>
          {{ isTranscribing ? 'Stop Transcription' : 'Start Transcription' }}
        </button>
        <button @click="$router.push('/settings')" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
          <span>⚙️</span> Settings
        </button>
        <button @click="createNewPreset" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
          + New Preset
        </button>
      </div>
    </header>

    <div class="flex-1 flex gap-6 min-h-0">
      <!-- Preset Cards List -->
      <div class="w-1/3 overflow-y-auto space-y-4 pr-2">
        <div 
          v-for="preset in presets" 
          :key="preset.id" 
          @click="selectPreset(preset)"
          class="bg-gray-800 rounded-xl p-4 border cursor-pointer transition-all duration-200 relative group"
          :class="selectedPresetId === preset.id ? 'border-blue-500 bg-gray-750 shadow-lg shadow-blue-500/10' : 'border-gray-700 hover:border-gray-600'"
        >
          <div class="flex justify-between items-start mb-3">
            <div class="flex items-center gap-2">
              <h3 class="font-bold text-lg text-white group-hover:text-blue-200 transition-colors">{{ preset.name }}</h3>
              <span v-if="activeWindows.has(preset.id)" class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            </div>
            
            <div class="flex gap-1">
              <!-- Open/Close Controls -->
              <button 
                v-if="!activeWindows.has(preset.id)"
                @click.stop="openWindow(preset)" 
                class="bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-1 rounded transition-colors uppercase font-bold tracking-wide"
              >
                Open
              </button>
              <template v-else>
                <button 
                  @click.stop="bringToFront(preset.id)" 
                  class="bg-blue-700 hover:bg-blue-600 text-white text-xs px-2 py-1 rounded transition-colors"
                  title="Bring to front"
                >
                  ↑
                </button>
                <button 
                  @click.stop="closeWindow(preset.id)" 
                  class="bg-red-900/80 hover:bg-red-800 text-red-100 text-xs px-3 py-1 rounded transition-colors uppercase font-bold tracking-wide"
                >
                  Close
                </button>
              </template>
            </div>
          </div>
          
          <div class="space-y-1 mb-4">
             <div class="flex items-center gap-2 text-xs text-gray-400">
                <span>🖥️</span>
                <span>{{ getDisplayLabel(preset.targetDisplayId) }}</span>
             </div>
          </div>

          <!-- Card Actions Footer -->
          <div class="flex items-center justify-between border-t border-gray-700/50 pt-3 mt-2">
             <button @click.stop="deletePreset(preset.id)" class="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-900/20 transition-colors">
               Delete
             </button>

             <button @click.stop="duplicatePreset(preset)" class="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-900/20 transition-colors ml-auto mr-2">
               Duplicate
             </button>
             
             <button 
               @click.stop="savePreset(preset)" 
               class="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1.5 rounded transition-colors flex items-center gap-1"
               title="Save current layout changes to this preset"
             >
               <span>💾</span> Save Preset
             </button>
          </div>
        </div>
      </div>

      <!-- Editor Panel (Right Side) -->
      <div v-if="selectedPreset" class="w-2/3 bg-gray-800 rounded-xl p-6 border border-gray-700 overflow-y-auto">
        <h2 class="text-xl font-bold mb-6 border-b border-gray-700 pb-2 flex justify-between items-center">
          <span>Edit: <input v-model="selectedPreset.name" class="bg-transparent border-b border-gray-600 focus:border-blue-500 outline-none px-1" /></span>
          <button 
            v-if="activeWindows.has(selectedPreset.id)"
            @click="reloadWindow(selectedPreset.id)"
            class="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded flex items-center gap-2 transition-colors"
            title="Reload window with current settings"
          >
            🔄 Reload
          </button>
        </h2>
        
        <div class="grid grid-cols-2 gap-6">
          <!-- Colors -->
          <div class="space-y-4">
            <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider">Appearance</h3>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Background (Chroma)</label>
              <div class="flex gap-2">
                <input v-model="selectedPreset.style.backgroundColor" type="color" class="h-9 w-16 rounded cursor-pointer border border-gray-600" />
                <input v-model="selectedPreset.style.backgroundColor" type="text" class="flex-1 bg-gray-900 border border-gray-700 rounded px-3 text-sm font-mono uppercase" />
              </div>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Text Color</label>
              <div class="flex gap-2">
                <input v-model="selectedPreset.style.textColor" type="color" class="h-9 w-16 rounded cursor-pointer border border-gray-600" />
                 <input v-model="selectedPreset.style.textColor" type="text" class="flex-1 bg-gray-900 border border-gray-700 rounded px-3 text-sm font-mono uppercase" />
              </div>
            </div>
          </div>

          <!-- Typography -->
           <div class="space-y-4">
            <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider">Typography</h3>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Font Family</label>
              <select v-model="selectedPreset.style.fontFamily" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2">
                <option value="Arial">Arial</option>
                <option value="Verdana">Verdana</option>
                <option value="Helvetica">Helvetica</option>
                <option value="Georgia">Georgia</option>
                <option value="Courier New">Courier New</option>
                <option value="Impact">Impact</option>
              </select>
            </div>
             <div>
              <label class="block text-sm text-gray-400 mb-1">Font Size: <span class="text-blue-400">{{ selectedPreset.style.fontSize }}px</span></label>
              <input v-model.number="selectedPreset.style.fontSize" type="range" min="12" max="120" class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
            </div>
            <div class="flex items-center gap-2 pt-2">
               <input v-model="selectedPreset.style.textShadow" type="checkbox" id="shadow" class="w-5 h-5 rounded border-gray-600 accent-blue-500" />
               <label for="shadow" class="text-sm select-none cursor-pointer text-gray-300">Enable Text Shadow</label>
            </div>
          </div>

           <!-- Layout -->
           <div class="col-span-2 grid grid-cols-2 gap-6 pt-4 border-t border-gray-700/50">
             <div>
               <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider mb-4">Layout</h3>
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm text-gray-400 mb-1">Vertical Alignment</label>
                    <select v-model="selectedPreset.style.justifyContent" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2">
                      <option value="flex-start">Top</option>
                      <option value="center">Center</option>
                      <option value="flex-end">Bottom</option>
                    </select>
                  </div>
                   <div>
                      <label class="block text-sm text-gray-400 mb-1">Max Lines (0 = Unlimited)</label>
                      <input v-model.number="selectedPreset.style.maxLines" type="number" min="0" max="10" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2" />
                   </div>
                </div>
             </div>

             <!-- Hardware -->
             <div>
               <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider mb-4">Display Target</h3>
               <div class="space-y-4">
                 <div>
                   <label class="block text-sm text-gray-400 mb-1">Target Display</label>
                   <select v-model="selectedPreset.targetDisplayId" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2">
                     <option :value="undefined">Windowed Mode (Default)</option>
                     <option v-for="display in displays" :key="display.id" :value="display.id">
                       {{ display.label }} ({{ display.bounds.width }}x{{ display.bounds.height }})
                     </option>
                   </select>
                   <p class="text-xs text-gray-500 mt-1">If set, opening will force fullscreen on this display.</p>
                 </div>
                 
                 <div>
                   <label class="block text-sm text-gray-400 mb-1">Display Language</label>
                   <select v-model="selectedPreset.language" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2">
                     <option value="live">🎙️ Live Captions (No Translation)</option>
                     <option value="en">🇬🇧 English</option>
                     <option value="tr">🇹🇷 Turkish</option>
                     <option value="es">🇪🇸 Spanish</option>
                     <option value="fr">🇫🇷 French</option>
                     <option value="de">🇩🇪 German</option>
                     <option value="it">🇮🇹 Italian</option>
                     <option value="pt">🇵🇹 Portuguese</option>
                     <option value="ru">🇷🇺 Russian</option>
                     <option value="ja">🇯🇵 Japanese</option>
                     <option value="ko">🇰🇷 Korean</option>
                     <option value="zh">🇨🇳 Chinese</option>
                     <option value="ar">🇸🇦 Arabic</option>
                   </select>
                   <p class="text-xs text-gray-500 mt-1">Select 'Live Captions' for original text, or choose a language for real-time translation.</p>
                 </div>
                 
                 <p class="text-xs text-gray-400">💡 Microphone is now configured globally in Settings.</p>
               </div>
             </div>
            
            <!-- Position Controls -->
            <div class="col-span-2 space-y-4 pt-4 border-t border-gray-700/50">
              <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider">Subtitle Position</h3>
              
              <div>
                <label class="block text-sm text-gray-400 mb-1">
                  Horizontal (X): <span class="text-blue-400">{{ selectedPreset.style.positionX }}%</span>
                </label>
                <input 
                  v-model.number="selectedPreset.style.positionX" 
                  type="range" 
                  min="0" 
                  max="100" 
                  class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" 
                />
                <p class="text-xs text-gray-500 mt-1">0% = Left edge, 50% = Center, 100% = Right edge</p>
              </div>
              
              <div>
                <label class="block text-sm text-gray-400 mb-1">
                  Vertical (Y): <span class="text-blue-400">{{ selectedPreset.style.positionY }}%</span>
                </label>
                <input 
                  v-model.number="selectedPreset.style.positionY" 
                  type="range" 
                  min="0" 
                  max="100" 
                  class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" 
                />
                <p class="text-xs text-gray-500 mt-1">0% = Top edge, 50% = Center, 100% = Bottom edge</p>
              </div>
            </div>
           </div>
        </div>
      </div>
      
      <div v-else class="w-2/3 flex flex-col items-center justify-center text-gray-500 bg-gray-800/50 rounded-xl border border-dashed border-gray-700">
        <span class="text-4xl mb-4">👈</span>
        <p>Select a Preset to edit or Open/Close windows</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

interface WindowStyle {
  backgroundColor: string
  textColor: string
  fontSize: number
  fontFamily: string
  textShadow: boolean
  maxLines: number
  justifyContent: 'flex-start' | 'center' | 'flex-end'
  positionX: number  // 0-100 (percentage from left)
  positionY: number  // 0-100 (percentage from top)
}

interface WindowPreset {
  id: string
  name: string
  audioDeviceId?: string
  targetDisplayId?: number
  language?: string  // 'live' or language code (en, tr, es, etc.)
  style: WindowStyle
}

const presets = ref<WindowPreset[]>([])
const activeWindows = ref<Set<string>>(new Set()) // Track IDs of open windows
const isTranscribing = ref(false)
const audioLevel = ref(0) // VU meter level (0-100)

// GCP Audio streaming state
let gcpAudioStream: MediaStream | null = null
let gcpAudioContext: AudioContext | null = null
let gcpScriptProcessor: ScriptProcessorNode | null = null

const audioDevices = ref<MediaDeviceInfo[]>([])
const displays = ref<any[]>([])

const selectedPresetId = ref<string | null>(null)
const selectedPreset = computed(() => presets.value.find(p => p.id === selectedPresetId.value))

onMounted(async () => {
  await getAudioDevices()
  navigator.mediaDevices.ondevicechange = getAudioDevices
  await getDisplays()
  await loadPresets()
  
  // Sync active windows
  const activeIds = await window.ipcRenderer.invoke('get-active-windows')
  activeWindows.value = new Set(activeIds)
  
  // Start VU meter monitoring
  startVUMeter()
})

const getDisplays = async () => {
  displays.value = await window.ipcRenderer.invoke('get-displays')
}

const getAudioDevices = async () => {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true })
    const devices = await navigator.mediaDevices.enumerateDevices()
    audioDevices.value = devices.filter(d => d.kind === 'audioinput')
  } catch (error) {
    console.error('Failed to enumerate devices:', error)
  }
}

const getDisplayLabel = (id?: number) => {
  if (!id) return 'Windowed'
  const d = displays.value.find(disp => disp.id === id)
  return d ? d.label : 'Unknown Display'
}

onUnmounted(() => {
  stopVUMeter()
})

const loadPresets = async () => {
  const saved = await window.ipcRenderer.invoke('get-project-state') as WindowPreset[]
  if (saved && saved.length > 0) {
    // Migrate old presets to include position and language defaults
    presets.value = saved.map(p => ({
      ...p,
      language: p.language ?? 'live',  // Default to live captions
      style: {
        ...p.style,
        positionX: p.style.positionX ?? 50,  // Center by default
        positionY: p.style.positionY ?? 50   // Center by default
      }
    }))
  }
}

const savePresetsToDisk = async () => {
  await window.ipcRenderer.invoke('save-project-state', JSON.parse(JSON.stringify(presets.value)))
}

const createNewPreset = () => {
  const newPreset: WindowPreset = {
    id: Date.now().toString(),
    name: `Preset ${presets.value.length + 1}`,
    language: 'live',  // Default to no translation
    style: {
      backgroundColor: '#00FF00',
      textColor: '#FFFFFF',
      fontSize: 48,
      fontFamily: 'Arial',
      textShadow: true,
      maxLines: 4, // Increased default to prevent cutting off long sentences
      justifyContent: 'center',
      positionX: 50,  // Center horizontally
      positionY: 50   // Center vertically
    }
  }
  presets.value.push(newPreset)
  selectedPresetId.value = newPreset.id
  savePresetsToDisk()
}

const deletePreset = async (id: string) => {
  if (confirm('Are you sure you want to delete this preset?')) {
    if (activeWindows.value.has(id)) {
      await closeWindow(id)
    }
    presets.value = presets.value.filter(p => p.id !== id)
    if (selectedPresetId.value === id) selectedPresetId.value = null
    savePresetsToDisk()
  }
}

const duplicatePreset = (preset: WindowPreset) => {
  const newPreset: WindowPreset = {
    ...JSON.parse(JSON.stringify(preset)), // Deep copy to avoid reference issues
    id: Date.now().toString(),
    name: `${preset.name} (Copy)`
  }
  presets.value.push(newPreset)
  // Select the new duplicate
  selectedPresetId.value = newPreset.id
  savePresetsToDisk()
}

const savePreset = async (_preset: WindowPreset) => {
  // Current state of 'preset' is already reactive and updated via v-model
  // Just need to persist to disk
  await savePresetsToDisk()
  
  // Also update live window if active
  if (activeWindows.value.has(_preset.id)) {
    updateLiveWindow(_preset)
  }
}

const updateLiveWindow = (preset: WindowPreset) => {
    // Convert reactive objects to plain objects for IPC serialization
    const plainStyle = JSON.parse(JSON.stringify(preset.style))
    
    // Send style update
    window.ipcRenderer.invoke('update-projection-settings', { 
      id: preset.id, 
      style: plainStyle
    })
    // Send audio update
    if (preset.audioDeviceId) {
      window.ipcRenderer.invoke('update-projection-settings', { 
        id: preset.id, 
        audioDeviceId: preset.audioDeviceId 
      })
    }
}

const bringToFront = async (id: string) => {
  await window.ipcRenderer.invoke('bring-to-front', { id })
}

const reloadWindow = async (id: string) => {
  const preset = presets.value.find(p => p.id === id)
  if (preset) {
    updateLiveWindow(preset)
  }
}

const openWindow = async (preset: WindowPreset) => {
  try {
    await window.ipcRenderer.invoke('create-projection-window', preset.id)
    activeWindows.value.add(preset.id)
    
    // Set language preference for this window
    await window.ipcRenderer.invoke('set-window-language', {
      windowId: preset.id,
      language: preset.language || 'live'
    })
    
    // Position window if display target is set
    if (preset.targetDisplayId) {
      await window.ipcRenderer.invoke('move-to-display', {
        windowId: preset.id,
        displayId: preset.targetDisplayId
      })
    }

    // Apply settings after a brief delay to ensure window load
    setTimeout(() => {
        updateLiveWindow(preset)
    }, 500)

  } catch (error) {
    console.error('Failed to open window:', error)
  }
}

const closeWindow = async (id: string) => {
  try {
    await window.ipcRenderer.invoke('close-projection-window', id)
    activeWindows.value.delete(id)
  } catch (error) {
    console.error('Failed to close window:', error)
  }
}

const selectPreset = (preset: WindowPreset) => {
  selectedPresetId.value = preset.id
}

let vuMeterStream: MediaStream | null = null
let vuMeterContext: AudioContext | null = null
let vuMeterAnalyser: AnalyserNode | null = null
let vuMeterAnimationFrame: number | null = null

const startVUMeter = async () => {
  try {
    const settings = await window.ipcRenderer.invoke('get-settings', 'transcription')
    const deviceId = settings?.audioDeviceId
    
    const constraints: MediaStreamConstraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true
    }
    
    vuMeterStream = await navigator.mediaDevices.getUserMedia(constraints)
    vuMeterContext = new AudioContext()
    vuMeterAnalyser = vuMeterContext.createAnalyser()
    vuMeterAnalyser.fftSize = 256
    vuMeterAnalyser.smoothingTimeConstant = 0.8
    
    const source = vuMeterContext.createMediaStreamSource(vuMeterStream)
    source.connect(vuMeterAnalyser)
    
    const dataArray = new Uint8Array(vuMeterAnalyser.frequencyBinCount)
    
    const updateLevel = () => {
      vuMeterAnalyser!.getByteFrequencyData(dataArray)
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
      audioLevel.value = Math.min(100, (average / 128) * 100)
      vuMeterAnimationFrame = requestAnimationFrame(updateLevel)
    }
    
    updateLevel()
  } catch (error) {
    console.error('Failed to start VU meter:', error)
  }
}

const stopVUMeter = () => {
  if (vuMeterAnimationFrame) {
    cancelAnimationFrame(vuMeterAnimationFrame)
    vuMeterAnimationFrame = null
  }
  if (vuMeterStream) {
    vuMeterStream.getTracks().forEach(track => track.stop())
    vuMeterStream = null
  }
  if (vuMeterContext) {
    vuMeterContext.close()
    vuMeterContext = null
  }
  audioLevel.value = 0
}

const toggleTranscription = async () => {
  const settings = await window.ipcRenderer.invoke('get-settings', 'transcription')
  const provider = settings?.provider || 'LOCAL'
  
  if (isTranscribing.value) {
    // Stop transcription based on provider
    if (provider === 'GCP') {
      await window.ipcRenderer.invoke('stop-gcp-transcription')
      stopGcpAudioCapture()
    } else if (provider === 'LOCAL') {
      await window.ipcRenderer.invoke('stop-local-transcription')
    }
    // AWS and MOCK are handled in Projection window
    isTranscribing.value = false
  } else {
    // Start transcription based on provider
    if (provider === 'GCP') {
      await window.ipcRenderer.invoke('start-gcp-transcription', {
        gcpKeyJson: settings?.gcpKeyJson || '',
        language: settings?.language || 'en-US',
        gcpModel: settings?.gcpModel || 'latest_long',
        gcpEncoding: settings?.gcpEncoding || 'LINEAR16',
        gcpInterimResults: settings?.gcpInterimResults ?? true,
        gcpAutoPunctuation: settings?.gcpAutoPunctuation ?? true,
        gcpUseEnhanced: settings?.gcpUseEnhanced ?? false,
        gcpSingleUtterance: settings?.gcpSingleUtterance ?? false,
        gcpMaxAlternatives: settings?.gcpMaxAlternatives ?? 1
      })
      // Start audio capture and streaming
      await startGcpAudioCapture()
      isTranscribing.value = true
    } else if (provider === 'LOCAL') {
      const deviceId = audioDevices.value[0]?.deviceId || '0'
      const language = settings?.language || 'auto'
      const model = settings?.model || 'small'
      
      await window.ipcRenderer.invoke('start-local-transcription', {
        deviceId,
        language,
        model
      })
      isTranscribing.value = true
    } else if (provider === 'AWS' || provider === 'MOCK') {
      // AWS and MOCK are handled via Projection window service
      // Just toggle the flag, Projection.vue handles the actual service
      isTranscribing.value = true
    }
  }
}

// GCP Audio capture functions
const startGcpAudioCapture = async () => {
  try {
    gcpAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000, // GCP expects 16kHz
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true
      }
    })

    gcpAudioContext = new AudioContext({ sampleRate: 16000 })
    const source = gcpAudioContext.createMediaStreamSource(gcpAudioStream)
    
    // Use ScriptProcessorNode for audio processing (deprecated but widely supported)
    gcpScriptProcessor = gcpAudioContext.createScriptProcessor(4096, 1, 1)
    
    gcpScriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0)
      // Convert Float32Array to Int16Array (LINEAR16 format for GCP)
      const int16Data = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }
      // Send audio chunk to main process
      window.ipcRenderer.send('gcp-audio-chunk', int16Data.buffer)
    }

    source.connect(gcpScriptProcessor)
    gcpScriptProcessor.connect(gcpAudioContext.destination)
    
    console.log('GCP Audio capture started')
  } catch (error) {
    console.error('Failed to start GCP audio capture:', error)
  }
}

const stopGcpAudioCapture = () => {
  if (gcpScriptProcessor) {
    gcpScriptProcessor.disconnect()
    gcpScriptProcessor = null
  }
  if (gcpAudioContext) {
    gcpAudioContext.close()
    gcpAudioContext = null
  }
  if (gcpAudioStream) {
    gcpAudioStream.getTracks().forEach(track => track.stop())
    gcpAudioStream = null
  }
  console.log('GCP Audio capture stopped')
}

// Watch for changes in selected preset to auto-update live window (Real-time styling)
watch(() => selectedPreset.value, (newVal) => {
  if (newVal && activeWindows.value.has(newVal.id)) {
    // Debounce this slightly? Or just update.
    updateLiveWindow(newVal)
  }
}, { deep: true })

</script>
