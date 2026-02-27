<template>
  <div class="h-screen overflow-y-auto bg-gray-900 text-white p-6">
    <header class="mb-6 flex justify-between items-center">
      <h1 class="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
        Settings
      </h1>
      <button @click="$router.push('/')" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors">
        &larr; Back to Home
      </button>
    </header>

    <!-- Tab Navigation -->
    <div class="max-w-2xl mx-auto mb-6 flex gap-1 bg-gray-800 rounded-xl p-1 border border-gray-700">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        @click="activeTab = tab.id"
        :class="[
          'flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200',
          activeTab === tab.id
            ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg'
            : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
        ]"
      >
        <span>{{ tab.icon }}</span>
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <div class="max-w-2xl mx-auto bg-gray-800 p-8 rounded-xl border border-gray-700">

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!-- TAB 1: Speech-to-Text                                      -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'stt'" class="space-y-6">
        <!-- Provider Selection -->
        <div>
          <h2 class="text-xl font-semibold mb-4 text-white">Speech-to-Text Provider</h2>
          <div class="grid grid-cols-5 gap-2">
            <button
              v-for="p in sttProviders"
              :key="p.id"
              @click="settings.sttProvider = p.id"
              :class="[
                'flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium',
                settings.sttProvider === p.id
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-gray-700 hover:border-gray-600 text-gray-400 hover:text-gray-300'
              ]"
            >
              <span class="text-lg">{{ p.icon }}</span>
              <span>{{ p.name }}</span>
              <span class="text-[10px] opacity-60">{{ p.badge }}</span>
            </button>
          </div>
        </div>

        <!-- Audio & Language -->
        <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-purple-400">Audio & Language</h3>
          <div class="mb-4">
            <label class="block text-sm text-gray-400 mb-1">Microphone</label>
            <select v-model="settings.audioDeviceId" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <option :value="undefined">Default System Mic</option>
              <option v-for="device in audioDevices" :key="device.deviceId" :value="device.deviceId">
                {{ device.label }}
              </option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-2">Recognition Languages</label>
            <div class="space-y-2 bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" value="tr" v-model="settings.recognitionLanguages" class="w-4 h-4 rounded border-gray-600 text-blue-500" />
                <span class="text-sm text-white">Turkish (tr-TR)</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" value="en" v-model="settings.recognitionLanguages" class="w-4 h-4 rounded border-gray-600 text-blue-500" />
                <span class="text-sm text-white">English (en-US)</span>
              </label>
            </div>
            <p class="text-xs text-blue-400 mt-2">
              Select languages that might be spoken. For GCP, parallel streams run for each language.
              <br/><span class="text-yellow-500/80">⚠️ Multiple languages = more API usage.</span>
            </p>
          </div>
        </div>

        <!-- VAD Settings -->
        <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-lg font-medium text-green-400">🎙️ Voice Activity Detection (Silero VAD)</h3>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.vadEnabled" class="w-4 h-4 rounded border-gray-600 text-green-500" />
              <span class="text-sm text-gray-300">Enable</span>
            </label>
          </div>
          <p class="text-xs text-gray-500 mb-3">Only sends audio to STT when speech is detected. Saves bandwidth and reduces noise.</p>
          <div v-if="settings.vadEnabled" class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Sensitivity: {{ settings.vadThreshold }}</label>
              <input type="range" v-model.number="settings.vadThreshold" min="0.1" max="0.95" step="0.05" class="w-full" />
              <p class="text-xs text-gray-500 mt-1">Lower = more sensitive</p>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">Min Silence: {{ settings.vadMinSilence }}ms</label>
              <input type="range" v-model.number="settings.vadMinSilence" min="100" max="2000" step="100" class="w-full" />
              <p class="text-xs text-gray-500 mt-1">Wait before ending speech</p>
            </div>
          </div>
        </div>

        <!-- GCP Settings (v-if GCP) -->
        <div v-if="settings.sttProvider === 'GCP'" class="space-y-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-blue-400">Google Cloud Speech-to-Text</h3>

          <div class="bg-blue-900/20 border border-blue-500/30 rounded p-3 mb-4 text-xs text-blue-200">
            <p class="font-bold mb-1">💰 Pricing & Free Tier:</p>
            <ul class="list-disc list-inside space-y-1 opacity-90">
              <li><strong>Standard:</strong> FREE for first 60 min/month. Then $0.024/min.</li>
              <li><strong>Enhanced:</strong> $0.036/min (no free tier).</li>
            </ul>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Speech Model</label>
            <select v-model="settings.gcpModel" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <optgroup label="✨ Enhanced / Premium ($0.036/min)">
                <option value="latest_long">Latest Long — Best for conversations</option>
                <option value="latest_short">Latest Short — Short utterances</option>
              </optgroup>
              <optgroup label="🎁 Standard / Free Tier ($0.024/min)">
                <option value="default">Default — General purpose</option>
                <option value="command_and_search">Command & Search</option>
                <option value="phone_call">Phone Call (EN only)</option>
                <option value="video">Video (EN only)</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Audio Encoding</label>
            <select v-model="settings.gcpEncoding" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <option value="LINEAR16">LINEAR16 (Uncompressed PCM)</option>
              <option value="FLAC">FLAC (Lossless)</option>
              <option value="MULAW">MULAW (Telephony)</option>
              <option value="OGG_OPUS">OGG_OPUS</option>
            </select>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Confidence Threshold: {{ settings.gcpConfidenceThreshold }}</label>
            <div class="flex items-center gap-4">
              <input type="range" v-model.number="settings.gcpConfidenceThreshold" min="0" max="1" step="0.01" class="flex-1" />
              <input type="number" v-model.number="settings.gcpConfidenceThreshold" min="0" max="1" step="0.01" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-center text-sm" />
            </div>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Min Word Buffer: {{ settings.gcpMinWordBuffer }}</label>
            <div class="flex items-center gap-4">
              <input type="range" v-model.number="settings.gcpMinWordBuffer" min="0" max="10" step="1" class="flex-1" />
              <input type="number" v-model.number="settings.gcpMinWordBuffer" min="0" max="10" step="1" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-center text-sm" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.gcpInterimResults" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Interim Results</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.gcpAutoPunctuation" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Auto Punctuation</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.gcpUseEnhanced" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Use Enhanced Model</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.gcpProfanityFilter" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">🚫 Profanity Filter</span>
            </label>
          </div>
        </div>

        <!-- Whisper Settings (v-if LOCAL) -->
        <div v-if="settings.sttProvider === 'LOCAL'" class="space-y-4">
          <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
            <h3 class="text-lg font-medium mb-3 text-blue-400">🎧 Whisper Model</h3>
            <div class="mb-4">
              <label class="block text-sm text-gray-400 mb-1">Active Model</label>
              <select v-model="settings.model" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
                <option v-for="m in whisperModels" :key="m.id" :value="m.id" :disabled="!downloadedWhisperModels.includes(m.id)">
                  {{ m.name }} {{ !downloadedWhisperModels.includes(m.id) ? '(Not Downloaded)' : '' }}
                </option>
              </select>
            </div>
            <div class="space-y-2">
              <div v-for="m in whisperModels" :key="m.id" class="flex items-center justify-between p-3 bg-gray-800 rounded border border-gray-700">
                <div>
                  <div class="font-medium text-white text-sm">{{ m.name }}</div>
                  <div class="text-xs text-gray-500">{{ m.description }}</div>
                </div>
                <div class="flex items-center gap-2">
                  <span v-if="downloadedWhisperModels.includes(m.id)" class="text-green-500 text-xs font-bold px-2 py-1 bg-green-900/30 rounded">✓</span>
                  <button v-if="downloadedWhisperModels.includes(m.id)" @click="deleteWhisperModel(m.id)" :disabled="settings.model === m.id" class="text-xs bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-2 py-1 rounded transition-colors">🗑️</button>
                  <button v-else @click="downloadWhisperModel(m.id)" :disabled="!!downloadingModel" class="text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white px-2 py-1 rounded transition-colors">
                    {{ downloadingModel === m.id ? '...' : '⬇️' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
            <h3 class="text-lg font-medium mb-3 text-orange-400">Advanced Parameters</h3>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm text-gray-400 mb-1">Step (ms)</label>
                <input v-model.number="settings.step" type="number" min="100" max="2000" step="100" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Length (ms)</label>
                <input v-model.number="settings.length" type="number" min="1000" max="10000" step="500" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Beam Size</label>
                <input v-model.number="settings.beamSize" type="number" min="1" max="10" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" />
              </div>
              <div>
                <button @click="resetAdvancedSettings" class="w-full bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded transition-colors text-sm mt-6">Reset</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Sherpa-ONNX Settings (v-if SHERPA_ONNX) -->
        <div v-if="settings.sttProvider === 'SHERPA_ONNX'" class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-emerald-400">🗣️ Sherpa-ONNX Models</h3>
          <p class="text-xs text-gray-500 mb-4">Offline streaming ASR. Download a model for your language.</p>
          <div class="space-y-2">
            <div v-for="m in sherpaModels" :key="m.id"
              class="flex items-center justify-between p-3 rounded border transition-colors cursor-pointer"
              :class="settings.sherpaModel === m.id
                ? 'bg-emerald-900/30 border-emerald-500/50'
                : 'bg-gray-800 border-gray-700'"
              @click="downloadedSherpaModels.includes(m.id) && (settings.sherpaModel = m.id)">
              <div class="flex items-center gap-3">
                <input type="radio" :value="m.id" v-model="settings.sherpaModel"
                  :disabled="!downloadedSherpaModels.includes(m.id)"
                  class="accent-emerald-500" />
                <div>
                  <div class="font-medium text-white text-sm">{{ m.name }}</div>
                  <div class="text-xs text-gray-500">{{ m.size }}</div>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <span v-if="downloadedSherpaModels.includes(m.id)" class="text-green-500 text-xs font-bold px-2 py-1 bg-green-900/30 rounded">✓ Ready</span>
                <button v-if="downloadedSherpaModels.includes(m.id)" @click.stop="deleteSherpaModel(m.id)" class="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded transition-colors">🗑️</button>
                <button v-else @click.stop="downloadSherpaModel(m.id)" :disabled="!!downloadingModel" class="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white px-2 py-1 rounded transition-colors">
                  {{ downloadingModel === m.id ? 'Downloading...' : '⬇️ Download' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Deepgram Settings (v-if DEEPGRAM) -->
        <div v-if="settings.sttProvider === 'DEEPGRAM'" class="space-y-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-teal-400">🔊 Deepgram</h3>

          <div class="bg-teal-900/20 border border-teal-500/30 rounded p-3 mb-4 text-xs text-teal-200">
            <p class="font-bold mb-1">💰 Pricing & Free Tier:</p>
            <ul class="list-disc list-inside space-y-1 opacity-90">
              <li><strong>Pay-as-you-go:</strong> $0.0043/min (Nova-3). Free $200 credit on signup.</li>
              <li><strong>Language detection</strong> built-in — no need for parallel streams!</li>
            </ul>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Model</label>
            <select v-model="settings.deepgramModel" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <optgroup label="✨ Nova (Latest)">
                <option value="nova-3">Nova-3 — Best accuracy & speed</option>
                <option value="nova-2">Nova-2 — Previous gen</option>
                <option value="nova">Nova — First gen</option>
              </optgroup>
              <optgroup label="📦 Legacy">
                <option value="enhanced">Enhanced</option>
                <option value="base">Base</option>
              </optgroup>
            </select>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Language</label>
            <select v-model="settings.deepgramLanguage" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <optgroup label="🌍 Auto">
                <option value="multi">Multi (Auto Detect)</option>
              </optgroup>
              <optgroup label="Languages">
                <option v-for="l in deepgramLanguages" :key="l.code" :value="l.code">{{ l.name }}</option>
              </optgroup>
            </select>
            <p class="text-xs text-teal-400 mt-1">
              "Multi" enables automatic language detection — single stream handles all languages.
            </p>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Audio Encoding</label>
            <select v-model="settings.deepgramEncoding" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <option value="linear16">Linear16 (PCM)</option>
              <option value="flac">FLAC</option>
              <option value="mulaw">Mulaw</option>
              <option value="amr-nb">AMR-NB</option>
              <option value="amr-wb">AMR-WB</option>
              <option value="opus">Opus</option>
              <option value="speex">Speex</option>
            </select>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Endpointing: {{ settings.deepgramEndpointing === 0 ? 'Disabled' : settings.deepgramEndpointing + 'ms' }}</label>
            <div class="flex items-center gap-4">
              <input type="range" v-model.number="settings.deepgramEndpointing" min="0" max="5000" step="100" class="flex-1" />
              <input type="number" v-model.number="settings.deepgramEndpointing" min="0" max="5000" step="100" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-center text-sm" />
            </div>
            <p class="text-xs text-gray-500 mt-1">How long to wait for speech pause before finalizing (0 = disabled)</p>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Utterance End: {{ settings.deepgramUtteranceEndMs }}ms</label>
            <div class="flex items-center gap-4">
              <input type="range" v-model.number="settings.deepgramUtteranceEndMs" min="0" max="5000" step="100" class="flex-1" />
              <input type="number" v-model.number="settings.deepgramUtteranceEndMs" min="0" max="5000" step="100" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-center text-sm" />
            </div>
            <p class="text-xs text-gray-500 mt-1">Timeout after last word before sending UtteranceEnd event</p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.deepgramPunctuate" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Punctuate</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.deepgramDiarize" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Diarize (Speaker ID)</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.deepgramUtterances" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Utterances</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.deepgramInterimResults" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Interim Results</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.deepgramSmartFormat" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Smart Format</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.deepgramProfanityFilter" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">🚫 Profanity Filter</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.deepgramFillerWords" class="w-4 h-4 rounded border-gray-600" />
              <span class="text-sm text-gray-300">Filler Words (um, uh)</span>
            </label>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Audio Chunk Size: {{ settings.deepgramChunkMs }}ms</label>
            <div class="flex items-center gap-4">
              <input type="range" v-model.number="settings.deepgramChunkMs" min="20" max="200" step="10" class="flex-1" />
              <input type="number" v-model.number="settings.deepgramChunkMs" min="20" max="200" step="10" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-center text-sm" />
            </div>
            <p class="text-xs text-gray-500 mt-1">Size of audio chunks sent to Deepgram. Smaller = lower latency, larger = more stable.</p>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Keywords (comma separated)</label>
            <input v-model="settings.deepgramKeywords" type="text" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" placeholder="DilMesh, Deepgram, specific terms..." />
            <p class="text-xs text-gray-500 mt-1">Boost recognition of specific terms. Only works with Nova-2 model (ignored for Nova-3).</p>
          </div>
        </div>

        <!-- Riva Settings (v-if RIVA) -->
        <div v-if="settings.sttProvider === 'RIVA'" class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-amber-400">⚡ NVIDIA Riva</h3>
          <p class="text-xs text-gray-500 mb-2">Configure your Riva server connection in the <button @click="activeTab = 'api'" class="text-blue-400 underline">API Integrations</button> tab.</p>
          <div class="bg-amber-900/20 border border-amber-500/30 rounded p-3 text-xs text-amber-200">
            <p class="font-bold mb-1">⚠️ Requirements:</p>
            <ul class="list-disc list-inside space-y-1 opacity-90">
              <li>A running NVIDIA Riva Server (self-hosted or cloud)</li>
              <li>NVIDIA GPU recommended for the server</li>
              <li>Does NOT support Turkish ASR</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!-- TAB 2: Translation                                         -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'translation'" class="space-y-6">
        <div>
          <h2 class="text-xl font-semibold mb-4 text-white">Translation Provider</h2>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="p in translationProviders"
              :key="p.id"
              @click="settings.translationProvider = p.id"
              :class="[
                'flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-all text-xs font-medium',
                settings.translationProvider === p.id
                  ? 'border-purple-500 bg-purple-500/10 text-purple-400'
                  : 'border-gray-700 hover:border-gray-600 text-gray-400 hover:text-gray-300'
              ]"
            >
              <span class="text-lg">{{ p.icon }}</span>
              <span>{{ p.name }}</span>
              <span class="text-[10px] opacity-60">{{ p.badge }}</span>
            </button>
          </div>
        </div>

        <!-- GCP Translation Settings -->
        <div v-if="settings.translationProvider === 'GCP'" class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-purple-400">Google Cloud Translation</h3>
          <div class="bg-purple-900/20 border border-purple-500/30 rounded p-3 mb-4 text-xs text-purple-200">
            <p class="font-bold mb-1">💰 Pricing:</p>
            <ul class="list-disc list-inside space-y-1 opacity-90">
              <li><strong>Basic (V2):</strong> FREE for first 500K chars/month. Then $20/1M chars.</li>
              <li><strong>Advanced (V3):</strong> $20/1M chars, no free tier.</li>
            </ul>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Translation Edition</label>
            <select v-model="settings.gcpTranslationModel" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2">
              <option value="v2">🎁 Basic (V2) — Free Tier Eligible</option>
              <option value="v3" disabled>✨ Advanced (V3) — Paid Only (Coming Soon)</option>
            </select>
          </div>
        </div>

        <!-- NLLB-200 Settings -->
        <div v-if="settings.translationProvider === 'NLLB'" class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-pink-400">🧠 NLLB-200 (Offline)</h3>
          <p class="text-xs text-gray-500 mb-4">Meta's NLLB-200 model — 200 languages, runs 100% offline after download.</p>

          <div class="flex items-center justify-between p-3 bg-gray-800 rounded border border-gray-700 mb-4">
            <div>
              <div class="font-medium text-white text-sm">NLLB-200 Distilled 600M</div>
              <div class="text-xs text-gray-500">~800MB download, ONNX quantized</div>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="nllbDownloaded" class="text-green-500 text-xs font-bold px-2 py-1 bg-green-900/30 rounded">✓ Ready</span>
              <button v-if="nllbDownloaded" @click.stop="deleteNllbModel" class="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded transition-colors">🗑️</button>
              <button v-else @click.stop="downloadNllbModel" :disabled="!!isDownloadingNllb" class="text-xs bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white px-2 py-1 rounded transition-colors">
                {{ isDownloadingNllb ? '⏳ Downloading...' : '⬇️ Download' }}
              </button>
            </div>
          </div>

          <div class="bg-pink-900/20 border border-pink-500/30 rounded p-3 text-xs text-pink-200">
            <p>💡 Click download to fetch the ONNX model (~800MB). It will stay on your PC and run securely offline.</p>
          </div>
        </div>

        <!-- Subtitle Display Settings (common) -->
        <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-cyan-400">📺 Subtitle Display</h3>

          <div class="mb-4">
            <label class="block text-sm text-gray-400 mb-1">Queue Max Depth: {{ settings.subtitleQueueMaxDepth === 0 ? 'Unlimited' : settings.subtitleQueueMaxDepth }}</label>
            <div class="flex items-center gap-4">
              <input type="range" v-model.number="settings.subtitleQueueMaxDepth" min="0" max="10" step="1" class="flex-1" />
              <input type="number" v-model.number="settings.subtitleQueueMaxDepth" min="0" max="10" step="1" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-center text-sm" />
            </div>
            <p class="text-xs text-blue-400 mt-1">0 = Unlimited. Higher values drop oldest sentences to stay real-time.</p>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-1">Reading Speed (CPS): {{ settings.subtitleCPS }}</label>
            <div class="flex items-center gap-4">
              <input type="range" v-model.number="settings.subtitleCPS" min="5" max="30" step="1" class="flex-1" />
              <input type="number" v-model.number="settings.subtitleCPS" min="5" max="30" step="1" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-center text-sm" />
            </div>
            <p class="text-xs text-blue-400 mt-1">Characters Per Second. Netflix standard: 17. Lower = longer display.</p>
          </div>

          <div>
            <label class="block text-sm text-gray-400 mb-2">Sentence Split Characters</label>
            <div class="flex flex-wrap gap-2">
              <label v-for="p in punctuationOptions" :key="p.char"
                class="flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm"
                :class="settings.sentenceSplitChars.includes(p.char)
                  ? 'bg-emerald-900/40 border-emerald-500/50 text-emerald-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'">
                <input type="checkbox" :value="p.char"
                  :checked="settings.sentenceSplitChars.includes(p.char)"
                  @change="togglePunctuation(p.char)"
                  class="sr-only" />
                <span class="font-mono text-lg">{{ p.char }}</span>
                <span class="text-xs">{{ p.label }}</span>
              </label>
            </div>
            <p class="text-xs text-blue-400 mt-1">Interim text is split into sentences when these characters are detected.</p>
          </div>
        </div>
      </div>

      <!-- ═══════════════════════════════════════════════════════════ -->
      <!-- TAB 3: API Integrations                                    -->
      <!-- ═══════════════════════════════════════════════════════════ -->
      <div v-if="activeTab === 'api'" class="space-y-6">
        <h2 class="text-xl font-semibold mb-4 text-white">API Integrations</h2>

        <!-- GCP -->
        <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-blue-400">☁️ Google Cloud</h3>
          <p class="text-xs text-gray-500 mb-3">Used for both Speech-to-Text and Translation when GCP is selected as provider.</p>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Service Account Key (JSON)</label>
            <textarea
              v-model="settings.gcpKeyJson"
              rows="4"
              class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 font-mono text-xs"
              placeholder='Paste your service account JSON key here...'
            ></textarea>
            <p class="text-xs text-gray-500 mt-1">
              Google Cloud Console → IAM & Admin → Service Accounts → Create Key
            </p>
          </div>
        </div>

        <!-- AWS -->
        <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-orange-400">🔶 AWS</h3>
          <div class="space-y-3">
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
        </div>

        <!-- Deepgram -->
        <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-teal-400">🔊 Deepgram</h3>
          <p class="text-xs text-gray-500 mb-3">Sign up at <a href="https://console.deepgram.com" target="_blank" class="text-teal-400 underline">console.deepgram.com</a> for a free API key ($200 credit).</p>
          <div>
            <label class="block text-sm text-gray-400 mb-1">API Key</label>
            <input v-model="settings.deepgramApiKey" type="password" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 font-mono text-xs" placeholder="Enter your Deepgram API key" />
          </div>
        </div>

        <!-- Riva -->
        <div class="p-4 bg-gray-900/50 rounded-lg border border-gray-700/50">
          <h3 class="text-lg font-medium mb-3 text-amber-400">⚡ NVIDIA Riva</h3>
          <div class="space-y-3">
            <div>
              <label class="block text-sm text-gray-400 mb-1">Server URL</label>
              <input v-model="settings.rivaServerUrl" type="text" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2" placeholder="localhost:50051" />
            </div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="settings.rivaUseSsl" class="w-4 h-4 rounded border-gray-600 text-amber-500" />
              <span class="text-sm text-gray-300">Use SSL/TLS</span>
            </label>
            <div v-if="settings.rivaUseSsl">
              <label class="block text-sm text-gray-400 mb-1">SSL Certificate (PEM)</label>
              <textarea
                v-model="settings.rivaSslCert"
                rows="3"
                class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 font-mono text-xs"
                placeholder="-----BEGIN CERTIFICATE-----"
              ></textarea>
            </div>
          </div>
        </div>
      </div>

      <!-- Save Button -->
      <div class="mt-8 flex justify-end">
        <button @click="saveSettings" class="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white px-8 py-2.5 rounded-lg font-medium transition-all shadow-lg">
          💾 Save Settings
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const activeTab = ref<'stt' | 'translation' | 'api'>('stt')

const tabs = [
  { id: 'stt' as const, icon: '🎙️', label: 'Speech-to-Text' },
  { id: 'translation' as const, icon: '🌐', label: 'Translation' },
  { id: 'api' as const, icon: '🔑', label: 'API Integrations' },
]

const sttProviders = [
  { id: 'GCP', name: 'GCP', icon: '☁️', badge: 'Cloud' },
  { id: 'DEEPGRAM', name: 'Deepgram', icon: '🔊', badge: 'Cloud' },
  { id: 'RIVA', name: 'Riva', icon: '⚡', badge: 'GPU Server' },
  { id: 'SHERPA_ONNX', name: 'Sherpa', icon: '🗣️', badge: 'Offline' },
  { id: 'LOCAL', name: 'Whisper', icon: '🎧', badge: 'Offline' },
]

const translationProviders = [
  { id: 'GCP', name: 'GCP', icon: '☁️', badge: 'Cloud' },
  { id: 'NLLB', name: 'NLLB-200', icon: '🧠', badge: 'Offline' },
  { id: 'RIVA_NMT', name: 'Riva NMT', icon: '⚡', badge: 'GPU Server' },
  { id: 'NONE', name: 'Disabled', icon: '🚫', badge: '' },
]

const settings = ref({
  // STT
  sttProvider: 'GCP',
  // Translation
  translationProvider: 'GCP',
  // VAD
  vadEnabled: true,
  vadThreshold: 0.5,
  vadMinSilence: 500,
  // Audio
  audioDeviceId: undefined as string | undefined,
  recognitionLanguages: ['en'] as string[],
  // GCP STT
  gcpModel: 'latest_long',
  gcpEncoding: 'LINEAR16',
  gcpInterimResults: true,
  gcpAutoPunctuation: true,
  gcpUseEnhanced: false,
  gcpSingleUtterance: false,
  gcpMaxAlternatives: 1,
  gcpConfidenceThreshold: 0.85,
  gcpMinWordBuffer: 3,
  gcpProfanityFilter: false,
  // GCP Translation
  gcpTranslationModel: 'v2',
  // Subtitle display
  subtitleQueueMaxDepth: 0,
  subtitleCPS: 17,
  sentenceSplitChars: ['.', '!', '?', '…'],
  // Sherpa-ONNX
  sherpaModel: '',
  // GCP credentials
  gcpKeyJson: '',
  // Deepgram
  deepgramApiKey: '',
  deepgramModel: 'nova-3',
  deepgramLanguage: 'multi',
  deepgramPunctuate: true,
  deepgramDiarize: false,
  deepgramUtterances: true,
  deepgramInterimResults: true,
  deepgramEndpointing: 300,
  deepgramSmartFormat: true,
  deepgramProfanityFilter: false,
  deepgramUtteranceEndMs: 1000,
  deepgramNoDelay: true,
  deepgramEncoding: 'linear16',
  deepgramFillerWords: false,
  deepgramKeywords: '',
  deepgramChunkMs: 50,
  // AWS
  awsRegion: 'us-east-1',
  awsAccessKeyId: '',
  awsSecretAccessKey: '',
  // Riva
  rivaServerUrl: 'localhost:50051',
  rivaUseSsl: false,
  rivaSslCert: '',
  // Whisper
  language: 'auto',
  model: 'small',
  step: 1000,
  length: 5000,
  keep: 400,
  beamSize: 5,
  vth: 0.7,
  // Legacy compat
  provider: 'GCP' as string,
})

const downloadedWhisperModels = ref<string[]>([])
const downloadedSherpaModels = ref<string[]>([])
const nllbDownloaded = ref(false)
const downloadingModel = ref<string | null>(null)
const audioDevices = ref<MediaDeviceInfo[]>([])

const whisperModels = [
  { id: 'tiny', name: 'Tiny', description: '~75MB, fastest' },
  { id: 'base', name: 'Base', description: '~142MB' },
  { id: 'small', name: 'Small', description: '~466MB, recommended' },
  { id: 'medium', name: 'Medium', description: '~1.5GB' },
  { id: 'large-v3-turbo', name: 'Large V3 Turbo', description: '~1.5GB, fast+accurate' },
  { id: 'large-v3-turbo-q8_0', name: 'Large V3 Turbo Q8 ⭐', description: '~834MB, best balance' },
  { id: 'large-v3-turbo-q5_0', name: 'Large V3 Turbo Q5', description: '~547MB' },
  { id: 'distil-large-v3', name: 'Distil Large V3', description: '~750MB, EN only' },
]

const sherpaModels = [
  { id: 'sherpa-omnilingual-1B-ctc', name: '🌍 Omnilingual 1B (1600 langs)', size: '~750MB' },
  { id: 'sherpa-omnilingual-300M-ctc', name: '🌍 Omnilingual 300M (1600 langs)', size: '~280MB' },
  { id: 'sherpa-zipformer-en', name: 'English Zipformer', size: '310MB' },
  { id: 'sherpa-zipformer-bilingual-zh-en', name: 'Chinese+English', size: '511MB' },
  { id: 'sherpa-paraformer-zh', name: 'Chinese Paraformer', size: '1GB' },
]

const deepgramLanguages = [
  { code: 'en', name: 'English' },
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'en-AU', name: 'English (AU)' },
  { code: 'tr', name: 'Turkish' },
  { code: 'de', name: 'German' },
  { code: 'fr', name: 'French' },
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'fi', name: 'Finnish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'cs', name: 'Czech' },
  { code: 'el', name: 'Greek' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'hr', name: 'Croatian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'eu', name: 'Basque' },
  { code: 'gl', name: 'Galician' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'et', name: 'Estonian' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'sw', name: 'Swahili' },
]

const punctuationOptions = [
  { char: '.', label: 'Period' },
  { char: '!', label: 'Exclamation' },
  { char: '?', label: 'Question' },
  { char: '…', label: 'Ellipsis' },
  { char: ',', label: 'Comma' },
  { char: ';', label: 'Semicolon' },
  { char: ':', label: 'Colon' },
]

const togglePunctuation = (char: string) => {
  const arr = settings.value.sentenceSplitChars as string[]
  const idx = arr.indexOf(char)
  if (idx >= 0) {
    arr.splice(idx, 1)
  } else {
    arr.push(char)
  }
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

onMounted(async () => {
  const s = await window.ipcRenderer.invoke('get-settings', 'transcription')
  if (s) {
    settings.value = { ...settings.value, ...s }

    // Migration: old 'provider' field → new 'sttProvider'
    if (s.provider && !s.sttProvider) {
      settings.value.sttProvider = s.provider
    }

    // Migration: recognitionLanguages
    if (!s.recognitionLanguages && s.language) {
      if (s.language === 'auto') {
        settings.value.recognitionLanguages = ['tr', 'en']
      } else {
        settings.value.recognitionLanguages = [s.language]
      }
    }
    if (!settings.value.recognitionLanguages || settings.value.recognitionLanguages.length === 0) {
      settings.value.recognitionLanguages = ['en']
    }
  }

  await refreshAllModels()
  await getAudioDevices()
  navigator.mediaDevices.ondevicechange = getAudioDevices
})

const refreshAllModels = async () => {
  downloadedWhisperModels.value = await window.ipcRenderer.invoke('get-downloaded-models')
  try {
    const downloadedModels = await window.ipcRenderer.invoke('get-downloaded-sherpa-models')
    downloadedSherpaModels.value = downloadedModels || []
  } catch { downloadedSherpaModels.value = [] }
  
  try {
    const nllb = await window.ipcRenderer.invoke('get-nllb-models')
    nllbDownloaded.value = nllb && nllb.length > 0
  } catch { nllbDownloaded.value = false }
}

// Whisper model management
const downloadWhisperModel = async (modelId: string) => {
  if (downloadingModel.value) return
  downloadingModel.value = modelId
  try {
    await window.ipcRenderer.invoke('download-model', modelId)
    await refreshAllModels()
    alert(`Model ${modelId} downloaded!`)
  } catch (error) {
    alert(`Error: ${error}`)
  } finally {
    downloadingModel.value = null
  }
}

const deleteWhisperModel = async (modelId: string) => {
  if (!confirm(`Delete model "${modelId}"?`)) return
  try {
    await window.ipcRenderer.invoke('delete-model', modelId)
    await refreshAllModels()
  } catch (error) {
    alert(`Error: ${error}`)
  }
}

// Sherpa-ONNX model management
const downloadSherpaModel = async (modelId: string) => {
  if (downloadingModel.value) return
  downloadingModel.value = modelId
  try {
    await window.ipcRenderer.invoke('download-sherpa-model', modelId)
    await refreshAllModels()
    // Auto-select the downloaded model
    settings.value.sherpaModel = modelId
    alert(`Sherpa-ONNX model downloaded and selected!`)
  } catch (error) {
    alert(`Error: ${error}`)
  } finally {
    downloadingModel.value = null
  }
}

const deleteSherpaModel = async (modelId: string) => {
  if (!confirm(`Delete Sherpa-ONNX model "${modelId}"?`)) return
  try {
    await window.ipcRenderer.invoke('delete-sherpa-model', modelId)
    await refreshAllModels() // refresh list
    if (settings.value.sherpaModel === modelId) {
      settings.value.sherpaModel = '' // clear selection if deleted
      // saveTranslationSettings() // This function doesn't exist in the provided context, removed.
    }
  } catch (error) {
    console.error('Failed to delete Sherpa model:', error)
    alert('Failed to delete model. Check console.')
  }
}

// NLLB model management
const isDownloadingNllb = ref(false)
const downloadNllbModel = async () => {
  if (isDownloadingNllb.value) return
  isDownloadingNllb.value = true
  try {
    const success = await window.ipcRenderer.invoke('initialize-nllb')
    if (success) {
      nllbDownloaded.value = true
      alert('NLLB-200 model downloaded and initialized successfully!')
    } else {
      alert('Failed to download NLLB-200. Check console for details.')
    }
  } catch (error: any) {
    console.error('Failed to download NLLB:', error)
    alert(`Error: ${error.message || 'Unknown error'}`)
  } finally {
    isDownloadingNllb.value = false
  }
}

const deleteNllbModel = async () => {
  if (!confirm('Delete NLLB-200 downloaded model?')) return
  try {
    await window.ipcRenderer.invoke('delete-nllb-model')
    nllbDownloaded.value = false
    alert('NLLB-200 model deleted.')
  } catch (error) {
    console.error('Failed to delete NLLB model:', error)
    alert('Failed to delete model.')
  }
}

const saveSettings = async () => {
  // Keep 'provider' in sync for backward compat
  settings.value.provider = settings.value.sttProvider

  await window.ipcRenderer.invoke('set-settings', 'transcription', JSON.parse(JSON.stringify(settings.value)))

  if (settings.value.gcpKeyJson) {
    await window.ipcRenderer.invoke('update-gcp-credentials', settings.value.gcpKeyJson)
  }

  // Update live pipeline settings
  window.ipcRenderer.send('update-sentence-split-chars', settings.value.sentenceSplitChars)
  await window.ipcRenderer.invoke('set-active-stt-provider', settings.value.sttProvider)

  alert('Settings saved!')
}

const resetAdvancedSettings = () => {
  settings.value.step = 1000
  settings.value.length = 5000
  settings.value.keep = 400
  settings.value.beamSize = 5
  settings.value.vth = 0.7
}
</script>
