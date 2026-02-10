<template>
  <div class="h-screen overflow-y-auto bg-gray-900 text-white p-6">
    <header class="mb-8 flex justify-between items-center">
      <h1 class="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
        Settings
      </h1>
      <button @click="$router.push('/')" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors">
        &larr; Back to Home
      </button>
    </header>

    <div class="max-w-2xl mx-auto bg-gray-800 p-8 rounded-xl border border-gray-700">
      <div class="space-y-6">
        <div>
          <h2 class="text-xl font-semibold mb-4 text-white">Transcription Provider</h2>
          <label class="block text-sm text-gray-400 mb-1">Service</label>
          <select v-model="settings.provider" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2">
            <option value="MOCK">Mock (Test)</option>
            <option value="AWS">AWS Transcribe</option>
            <option value="GCP">Google Cloud Speech</option>
            <option value="LOCAL">Local (Whisper.cpp)</option>
          </select>
        </div>

        <div v-if="settings.provider === 'LOCAL' || settings.provider === 'AWS' || settings.provider === 'GCP'" class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-purple-400">Audio & Language Configuration</h3>
          
          <div class="mb-4">
            <label class="block text-sm text-gray-400 mb-1">Microphone</label>
            <select v-model="settings.audioDeviceId" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <option :value="undefined">Default System Mic</option>
              <option v-for="device in audioDevices" :key="device.deviceId" :value="device.deviceId">
                {{ device.label }}
              </option>
            </select>
            <p class="text-xs text-gray-500 mt-1">Select the microphone to use for transcription.</p>
          </div>
          
          <div>
            <label class="block text-sm text-gray-400 mb-1">Target Language</label>
            <select v-model="settings.language" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <option value="auto">Auto-Detect (TR/EN)</option>
              <option value="tr">Turkish</option>
              <option value="en">English</option>
            </select>
            <p class="text-xs text-gray-500 mt-2">
              "Auto-Detect" works best for mixed Turkish/English speech. "Turkish" or "English" locks the model to that language for better stability.
            </p>
          </div>
        </div>

        <div v-if="settings.provider === 'LOCAL'" class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-blue-400">Model Management</h3>
          
          <div class="mb-4">
             <label class="block text-sm text-gray-400 mb-1">Active Model</label>
             <select v-model="settings.model" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
               <option v-for="model in availableModels" :key="model.id" :value="model.id" :disabled="!downloadedModels.includes(model.id)">
                 {{ model.name }} {{ !downloadedModels.includes(model.id) ? '(Not Downloaded)' : '' }}
               </option>
             </select>
             <p class="text-xs text-gray-500 mt-1">Select which downloaded model to use for transcription.</p>
          </div>

          <div class="space-y-3">
             <div v-for="model in availableModels" :key="model.id" class="flex items-center justify-between p-3 bg-gray-800 rounded border border-gray-700">
               <div>
                 <div class="font-medium text-white">{{ model.name }}</div>
                 <div class="text-xs text-gray-500">{{ model.description }}</div>
               </div>
               
               <div class="flex items-center gap-2">
                 <span v-if="downloadedModels.includes(model.id)" class="text-green-500 text-xs font-bold px-2 py-1 bg-green-900/30 rounded">
                   INSTALLED
                 </span>
                 <button 
                   v-if="downloadedModels.includes(model.id)"
                   @click="deleteModel(model.id)"
                   :disabled="settings.model === model.id"
                   class="text-xs bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors"
                   :title="settings.model === model.id ? 'Cannot delete active model' : 'Delete model'"
                 >
                   🗑️ Delete
                 </button>
                 <button 
                   v-else 
                   @click="downloadModel(model.id)"
                   :disabled="!!downloadingModel"
                   class="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-3 py-1.5 rounded transition-colors"
                 >
                   {{ downloadingModel === model.id ? 'Downloading...' : 'Download' }}
                 </button>
               </div>
             </div>
          </div>
        </div>

        <div v-if="settings.provider === 'LOCAL'" class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-orange-400">Advanced Whisper Parameters</h3>
          <p class="text-xs text-gray-500 mb-4">Fine-tune the transcription behavior. Default values are optimized for stability.</p>
          
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Step (ms)</label>
              <input v-model.number="settings.step" type="number" min="100" max="2000" step="100" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
              <p class="text-xs text-gray-500 mt-1">Decode interval. Lower = more frequent updates, higher CPU usage.</p>
            </div>
            
            <div>
              <label class="block text-sm text-gray-400 mb-1">Length (ms)</label>
              <input v-model.number="settings.length" type="number" min="1000" max="10000" step="500" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
              <p class="text-xs text-gray-500 mt-1">Context window size. Larger = more context, better accuracy.</p>
            </div>
            
            <div>
              <label class="block text-sm text-gray-400 mb-1">Keep (ms)</label>
              <input v-model.number="settings.keep" type="number" min="0" max="2000" step="100" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
              <p class="text-xs text-gray-500 mt-1">Audio overlap between segments. Higher = smoother transitions.</p>
            </div>
            
            <div>
              <label class="block text-sm text-gray-400 mb-1">Beam Size</label>
              <input v-model.number="settings.beamSize" type="number" min="1" max="10" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
              <p class="text-xs text-gray-500 mt-1">Search beam width. Higher = better accuracy, slower.</p>
            </div>
            
            <div>
              <label class="block text-sm text-gray-400 mb-1">VAD Threshold</label>
              <input v-model.number="settings.vth" type="number" min="0" max="1" step="0.05" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
              <p class="text-xs text-gray-500 mt-1">Voice activity detection. Lower = more sensitive to quiet speech.</p>
            </div>
            
            <div class="flex items-end">
              <button @click="resetAdvancedSettings" class="w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded transition-colors text-sm">
                Reset to Defaults
              </button>
            </div>
          </div>
        </div>

        <div v-if="settings.provider === 'AWS'" class="space-y-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-orange-400">AWS Configuration</h3>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Region</label>
            <input v-model="settings.awsRegion" type="text" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" placeholder="us-east-1" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Access Key ID</label>
            <input v-model="settings.awsAccessKeyId" type="text" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Secret Access Key</label>
            <input v-model="settings.awsSecretAccessKey" type="password" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
          </div>
        </div>

        <div v-if="settings.provider === 'GCP'" class="space-y-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-blue-400">Google Cloud Configuration</h3>
          
          <!-- Model Selection -->
          <div>
            <label class="block text-sm text-gray-400 mb-1">Speech Model</label>
            <select v-model="settings.gcpModel" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <option value="latest_long">Latest Long — Best for conversations (🌍 All languages)</option>
              <option value="latest_short">Latest Short — Short utterances (🌍 All languages)</option>
              <option value="default">Default — General purpose (🌍 All languages)</option>
              <option value="phone_call">Phone Call — Optimized for calls (🇺🇸 English only)</option>
              <option value="video">Video — Optimized for video (🇺🇸 English only)</option>
            </select>
            <p class="text-xs text-yellow-500 mt-1">⚠️ Phone Call & Video models only support English. Use Latest Long for Turkish.</p>
          </div>

          <!-- Encoding -->
          <div>
            <label class="block text-sm text-gray-400 mb-1">Audio Encoding</label>
            <select v-model="settings.gcpEncoding" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <option value="LINEAR16">LINEAR16 (Uncompressed 16-bit PCM)</option>
              <option value="FLAC">FLAC (Lossless compression)</option>
              <option value="MULAW">MULAW (8-bit telephony)</option>
              <option value="OGG_OPUS">OGG_OPUS (Opus in Ogg container)</option>
            </select>
            <p class="text-xs text-gray-500 mt-1">LINEAR16 recommended for best quality</p>
          </div>

          <!-- Max Alternatives -->
          <div>
            <label class="block text-sm text-gray-400 mb-1">Max Alternatives: {{ settings.gcpMaxAlternatives }}</label>
            <input type="range" v-model.number="settings.gcpMaxAlternatives" min="1" max="10" class="w-full" />
            <p class="text-xs text-gray-500 mt-1">Number of alternative transcriptions to return (1-10)</p>
          </div>

          <!-- Toggle Options -->
          <div class="grid grid-cols-2 gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.gcpInterimResults" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Interim Results</span>
            </label>
            <p class="text-xs text-gray-500 col-span-2 -mt-2">Show partial results while speaking</p>

            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.gcpAutoPunctuation" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Auto Punctuation</span>
            </label>
            <p class="text-xs text-gray-500 col-span-2 -mt-2">Automatically add punctuation marks</p>

            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.gcpUseEnhanced" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Use Enhanced Model</span>
            </label>
            <p class="text-xs text-gray-500 col-span-2 -mt-2">Higher accuracy (costs more)</p>

            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.gcpSingleUtterance" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Single Utterance</span>
            </label>
            <p class="text-xs text-gray-500 col-span-2 -mt-2">Stop after first speech pause (for commands)</p>
          </div>

          <!-- Service Account Key -->
          <div>
            <label class="block text-sm text-gray-400 mb-1">Service Account Key (JSON)</label>
            <textarea 
              v-model="settings.gcpKeyJson" 
              rows="4" 
              class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 font-mono text-xs"
              placeholder='Paste your service account JSON key here...'
            ></textarea>
            <p class="text-xs text-gray-500 mt-1">Get this from Google Cloud Console → IAM & Admin → Service Accounts → Create Key</p>
          </div>
        </div>
      </div>

      <div class="mt-8 flex justify-end">
        <button @click="saveSettings" class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors">
          Save Settings
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const settings = ref({
  provider: 'MOCK',
  awsRegion: 'us-east-1',
  awsAccessKeyId: '',
  awsSecretAccessKey: '',
  gcpKeyJson: '',
  gcpModel: 'latest_long',
  gcpEncoding: 'LINEAR16',
  gcpInterimResults: true,
  gcpAutoPunctuation: true,
  gcpUseEnhanced: false,
  gcpSingleUtterance: false,
  gcpMaxAlternatives: 1,
  language: 'auto',
  model: 'small',
  audioDeviceId: undefined as string | undefined,
  // Advanced Whisper parameters
  step: 1000,
  length: 5000,
  keep: 400,
  beamSize: 5,
  vth: 0.7
})

const downloadedModels = ref<string[]>([])
const downloadingModel = ref<string | null>(null)
const audioDevices = ref<MediaDeviceInfo[]>([])

const availableModels = [
  { id: 'tiny', name: 'Tiny', description: 'Disk: ~75MB, RAM: ~300MB. Fastest, lowest accuracy.' },
  { id: 'base', name: 'Base', description: 'Disk: ~142MB, RAM: ~400MB. Good balance for English.' },
  { id: 'small', name: 'Small', description: 'Disk: ~466MB, RAM: ~1GB. Recommended default.' },
  { id: 'medium', name: 'Medium', description: 'Disk: ~1.5GB, RAM: ~2.5GB. Better accuracy.' },
  { id: 'large-v3', name: 'Large V3', description: 'Disk: ~3GB, RAM: ~5GB. High accuracy.' },
  { id: 'large-v3-turbo', name: 'Large V3 Turbo', description: 'Disk: ~1.5GB, RAM: ~3GB. High accuracy, faster.' },
  // High-accuracy quantized models
  { id: 'large-v3-turbo-q8_0', name: 'Large V3 Turbo Q8 ⭐', description: 'Disk: ~834MB, RAM: ~2GB. Best accuracy/speed balance. Recommended!' },
  { id: 'large-v3-turbo-q5_0', name: 'Large V3 Turbo Q5', description: 'Disk: ~547MB, RAM: ~1.5GB. Good accuracy, smaller size.' },
  { id: 'distil-large-v3', name: 'Distil Large V3', description: 'Disk: ~750MB, RAM: ~2GB. 6x faster, English-optimized only.' },
]

const getAudioDevices = async () => {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true })
    const devices = await navigator.mediaDevices.enumerateDevices()
    audioDevices.value = devices.filter(d => d.kind === 'audioinput')
  } catch (error) {
    console.error('Failed to enumerate devices:', error)
  }
}

onMounted(async () => {
  const s = await window.ipcRenderer.invoke('get-settings', 'transcription')
  if (s) settings.value = { ...settings.value, ...s }
  await refreshDownloadedModels()
  await getAudioDevices()
  navigator.mediaDevices.ondevicechange = getAudioDevices
})

const refreshDownloadedModels = async () => {
  downloadedModels.value = await window.ipcRenderer.invoke('get-downloaded-models')
}

const downloadModel = async (modelId: string) => {
  if (downloadingModel.value) return
  
  downloadingModel.value = modelId
  try {
    const success = await window.ipcRenderer.invoke('download-model', modelId)
    if (success) {
      await refreshDownloadedModels()
      alert(`Model ${modelId} downloaded successfully!`)
    } else {
      alert(`Failed to download model ${modelId}`)
    }
  } catch (error) {
    console.error(error)
    alert(`Error downloading model: ${error}`)
  } finally {
    downloadingModel.value = null
  }
}

const deleteModel = async (modelId: string) => {
  if (!confirm(`Are you sure you want to delete the model "${modelId}"? You can re-download it later.`)) {
    return
  }
  
  try {
    const success = await window.ipcRenderer.invoke('delete-model', modelId)
    if (success) {
      await refreshDownloadedModels()
      alert(`Model ${modelId} deleted successfully!`)
    } else {
      alert(`Model ${modelId} was not found or already deleted.`)
    }
  } catch (error) {
    console.error(error)
    alert(`Error deleting model: ${error}`)
  }
}

const saveSettings = async () => {
  await window.ipcRenderer.invoke('set-settings', 'transcription', JSON.parse(JSON.stringify(settings.value)))
  alert('Settings saved successfully!')
}

const resetAdvancedSettings = () => {
  settings.value.step = 1000
  settings.value.length = 5000
  settings.value.keep = 400
  settings.value.beamSize = 5
  settings.value.vth = 0.7
}
</script>
