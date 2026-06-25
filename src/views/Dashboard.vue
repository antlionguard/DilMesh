<template>
  <div class="h-full bg-gray-900 text-white p-6 flex flex-col overflow-hidden">
    <header class="mb-4 flex-none flex justify-between items-center gap-4">
      <h1 class="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
        DilMesh
      </h1>
      
      <!-- VU Meter -->
      <div class="flex-1 max-w-md">
        <AnalogVuMeter v-if="selectedAudioDeviceId" :device-id="selectedAudioDeviceId" />
        <div v-else class="text-xs text-gray-500 text-center">Loading Audio Device...</div>
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
        <button @click="importPresets" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2" title="Import presets from a JSON file">
          <span>📥</span> Import
        </button>
        <button @click="exportPresets" class="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2" title="Export all presets to a JSON file">
          <span>📤</span> Export
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
          :class="[selectedPresetId === preset.id ? 'border-blue-500 bg-gray-750 shadow-lg shadow-blue-500/10' : 'border-gray-700 hover:border-gray-600', preset.enabled === false ? 'opacity-60' : '']"
        >
          <div class="flex justify-between items-start mb-3">
            <div class="flex items-center gap-2">
              <!-- Enable/disable switch — disabled presets do no STT/translation (no credit use) -->
              <button
                @click.stop="togglePresetEnabled(preset)"
                :class="preset.enabled !== false ? 'bg-green-500' : 'bg-gray-600'"
                class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-none"
                :title="preset.enabled !== false ? 'Enabled — click to disable (stops translation)' : 'Disabled — click to enable'"
              >
                <span :class="preset.enabled !== false ? 'translate-x-[18px]' : 'translate-x-0.5'" class="inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform"></span>
              </button>
              <h3 class="font-bold text-lg text-white group-hover:text-blue-200 transition-colors">{{ preset.name }}</h3>
              <span v-if="activeWindows.has(preset.id)" class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <span v-if="preset.enabled === false" class="text-[10px] text-gray-500 uppercase tracking-wide font-bold">Off</span>
            </div>
            
            <div class="flex gap-1">
              <!-- OBS URL copy -->
              <button
                @click.stop="copyObsUrl(preset)"
                class="text-xs px-2 py-1 rounded transition-colors uppercase font-bold tracking-wide"
                :class="obsCopiedId === preset.id ? 'bg-purple-600 text-white' : 'bg-purple-900/70 hover:bg-purple-800 text-purple-100'"
                :title="`Copy OBS Browser Source URL for ${preset.name}`"
              >
                {{ obsCopiedId === preset.id ? '✓ Copied' : 'OBS' }}
              </button>
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
             <div class="flex items-center gap-2 text-xs text-gray-400">
                <span>🌐</span>
                <span>{{ getLanguageSummary(preset) }}</span>
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
          <span>Edit: <input v-model="selectedPreset.name" type="text" class="bg-gray-900 border-b border-gray-600 focus:border-blue-500 outline-none px-2 py-0.5 rounded-sm" @click.stop /></span>
          <button 
            v-if="activeWindows.has(selectedPreset.id)"
            @click="reloadWindow(selectedPreset.id)"
            class="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded flex items-center gap-2 transition-colors"
            title="Reload window with current settings"
          >
            🔄 Reload
          </button>
        </h2>
        
        <div class="space-y-6">
          <!-- Shared Style Controls -->
          <div class="grid grid-cols-2 gap-6">
            <!-- Appearance -->
            <div class="space-y-4">
              <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider">Appearance</h3>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Background (Chroma)</label>
                <div class="flex gap-2">
                  <input v-model="selectedPreset.style.backgroundColor" type="color" class="h-9 w-16 rounded cursor-pointer border border-gray-600" />
                  <input v-model="selectedPreset.style.backgroundColor" type="text" class="flex-1 bg-gray-900 border border-gray-700 rounded px-3 text-sm font-mono uppercase" />
                </div>
              </div>
              <div class="flex items-center gap-2 pt-2">
                <input v-model="selectedPreset.style.textShadow" type="checkbox" :id="'shadow-'+selectedPreset.id" class="w-5 h-5 rounded border-gray-600 accent-blue-500" />
                <label :for="'shadow-'+selectedPreset.id" class="text-sm select-none cursor-pointer text-gray-300">Enable Text Shadow</label>
              </div>

              <!-- Background Image -->
              <div class="pt-2">
                <label class="block text-sm text-gray-400 mb-1">Background Image</label>
                <div class="flex items-center gap-2">
                  <div v-if="bgImageUrl" class="w-16 h-10 rounded border border-gray-600 bg-gray-900 overflow-hidden flex-none">
                    <img :src="bgImageUrl" class="w-full h-full object-cover" alt="bg" />
                  </div>
                  <button @click="selectBackgroundImage" class="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded transition-colors">
                    {{ selectedPreset.style.backgroundImage ? 'Change' : 'Select Image' }}
                  </button>
                  <button v-if="selectedPreset.style.backgroundImage" @click="removeBackgroundImage" class="bg-red-900/70 hover:bg-red-800 text-red-100 text-xs px-3 py-1.5 rounded transition-colors">
                    Remove
                  </button>
                </div>
                <div v-if="selectedPreset.style.backgroundImage" class="mt-3">
                  <label class="block text-sm text-gray-400 mb-1">
                    Opacity: <span class="text-blue-400">{{ Math.round((selectedPreset.style.backgroundOpacity ?? 1) * 100) }}%</span>
                  </label>
                  <input v-model.number="selectedPreset.style.backgroundOpacity" type="range" min="0" max="1" step="0.05" class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                </div>
              </div>
            </div>

            <!-- Layout & Display -->
            <div class="space-y-4">
              <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider">Display Target</h3>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Output Size (W × H)</label>
                <div class="flex items-center gap-2">
                  <input v-model.number="selectedPreset.outputWidth" type="number" min="0" :placeholder="String(outputWidth)" class="w-24 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm" />
                  <span class="text-gray-500">×</span>
                  <input v-model.number="selectedPreset.outputHeight" type="number" min="0" :placeholder="String(outputHeight)" class="w-24 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm" />
                  <button v-if="selectedPreset.targetDisplayId" @click="useDisplaySizeForOutput" class="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-2 py-1.5 rounded transition-colors" title="Use the target display resolution">
                    From display
                  </button>
                </div>
                <p class="text-xs text-gray-500 mt-1">OBS capture / canvas size (e.g. 5120 × 512). Drives grid widths &amp; preview. Set your OBS Browser Source to the same size. Boş = otomatik.</p>
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Target Display</label>
                <select v-model="selectedPreset.targetDisplayId" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2">
                  <option :value="undefined">Windowed Mode (Default)</option>
                  <option v-for="display in displays" :key="display.id" :value="display.id">
                    {{ display.label }} ({{ display.bounds.width }}x{{ display.bounds.height }})
                  </option>
                </select>
                <p class="text-xs text-gray-500 mt-1">Optional — only for projecting to a physical screen. For OBS capture leave as Windowed.</p>
              </div>
              <div>
                <label class="block text-sm text-gray-400 mb-1">Vertical Alignment</label>
                <select v-model="selectedPreset.style.justifyContent" class="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2">
                  <option value="flex-start">Top</option>
                  <option value="center">Center</option>
                  <option value="flex-end">Bottom</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Live Layout Preview -->
          <div class="pt-4 border-t border-gray-700/50">
            <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider mb-2">Preview</h3>
            <div
              class="relative w-full rounded-lg overflow-hidden border border-gray-700"
              :style="{
                aspectRatio: previewAspectRatio,
                backgroundColor: selectedPreset.style.backgroundColor,
                containerType: 'size'
              }"
            >
              <!-- Background image with opacity -->
              <div
                v-if="bgImageUrl"
                class="absolute inset-0"
                :style="{
                  backgroundImage: `url('${bgImageUrl}')`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  opacity: selectedPreset.style.backgroundOpacity ?? 1
                }"
              ></div>
              <!-- Grid line overlay (matches columns × rows) -->
              <div
                v-if="showGridLines"
                class="absolute inset-0 grid pointer-events-none"
                :style="{
                  gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${effectiveGridRows}, minmax(0, 1fr))`
                }"
              >
                <div v-for="n in (gridColumns * effectiveGridRows)" :key="'gl-' + n" class="border border-white/25"></div>
              </div>
              <!-- Positioned layers -->
              <div
                v-for="layer in selectedPreset.languages"
                :key="'preview-' + layer.id"
                class="cursor-pointer"
                :style="previewLayerStyle(layer)"
                :title="getLanguageLabel(layer.language)"
                @click="selectLayerFromPreview(layer)"
              >
                <div :style="previewTextStyle(layer)">{{ getLanguageLabel(layer.language) }}</div>
              </div>
              <div v-if="selectedPreset.languages.length === 0" class="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
                Add languages to see the layout
              </div>
            </div>
          </div>

          <!-- Auto Grid Layout -->
          <div class="pt-4 border-t border-gray-700/50">
            <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider mb-3">Auto Grid Layout</h3>
            <div class="flex flex-wrap items-end gap-3">
              <div>
                <label class="block text-xs text-gray-400 mb-1">Columns</label>
                <input v-model.number="gridColumns" type="number" min="1" max="30" class="w-20 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-400 mb-1">Rows <span class="text-gray-600">(0 = auto)</span></label>
                <input v-model.number="gridRows" type="number" min="0" max="30" class="w-24 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label class="block text-xs text-gray-400 mb-1">Gap (px)</label>
                <input v-model.number="gridGap" type="number" min="0" step="2" class="w-20 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm" />
              </div>
              <div class="text-xs text-gray-500 mb-2">
                {{ selectedPreset.languages.length }} layers → {{ gridColumns }}×{{ effectiveGridRows }} grid
              </div>
              <button @click="applyAutoGrid" class="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded transition-colors">
                📐 Apply Grid
              </button>
              <button @click="resetPositions" class="bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm px-4 py-2 rounded transition-colors">
                ↩ Reset Positions
              </button>
              <label class="flex items-center gap-1.5 text-xs text-gray-400 mb-2 cursor-pointer select-none">
                <input v-model="showGridLines" type="checkbox" class="w-4 h-4 rounded border-gray-600 accent-blue-500" />
                Show grid lines in preview
              </label>
            </div>
            <p class="text-xs text-gray-500 mt-2">Each language's <strong>maxWidth = {{ outputWidth }}px (output width) ÷ {{ gridColumns }} columns − {{ gridGap }}px gap = {{ Math.max(0, Math.floor(outputWidth / Math.max(1, gridColumns)) - gridGap) }}px</strong>. Assign a language to each cell below to match a bordered background image.</p>

            <!-- Cell assignment grid: pick which language goes in each box -->
            <div
              v-if="selectedPreset.languages.length > 0"
              class="mt-3 grid gap-1"
              :style="{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }"
            >
              <template v-for="r in effectiveGridRows" :key="'gr-' + r">
                <div v-for="c in gridColumns" :key="'gc-' + r + '-' + c" class="border border-gray-700 rounded bg-gray-900/40 p-1">
                  <div class="text-[10px] text-gray-600 mb-0.5 leading-none">R{{ r }}·C{{ c }}</div>
                  <select
                    :value="cellLayerId(r - 1, c - 1)"
                    @change="onCellChange(r - 1, c - 1, $event)"
                    class="w-full bg-gray-800 border border-gray-600 rounded px-1 py-1 text-xs"
                    :class="cellLayerId(r - 1, c - 1) ? 'text-white' : 'text-gray-500'"
                  >
                    <option value="">— empty —</option>
                    <option v-for="layer in selectedPreset.languages" :key="layer.id" :value="layer.id">
                      {{ getLanguageLabel(layer.language) }}
                    </option>
                  </select>
                </div>
              </template>
            </div>
          </div>

          <!-- Language Layers -->
          <div class="pt-4 border-t border-gray-700/50">
            <div class="flex justify-between items-center mb-4">
              <h3 class="font-semibold text-gray-400 text-sm uppercase tracking-wider">Languages</h3>
              <button @click="addLanguageLayer" class="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded transition-colors">
                + Add Language
              </button>
            </div>

            <!-- Bulk style: set values, then "Apply to all" (does not auto-apply) -->
            <div v-if="selectedPreset.languages.length > 0" class="mb-4 p-3 bg-gray-900/40 rounded-lg border border-gray-700/50">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs text-gray-400 uppercase tracking-wider">Bulk Style</span>
                <button @click="applyBulkToAll" class="bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-3 py-1.5 rounded transition-colors font-medium">
                  Apply to all ({{ selectedPreset.languages.length }})
                </button>
              </div>
              <div class="flex flex-wrap items-end gap-3">
                <div>
                  <label class="block text-[11px] text-gray-500 mb-1">Font Size: {{ bulk.fontSize }}px</label>
                  <input v-model.number="bulk.fontSize" type="range" min="12" max="120" class="w-32 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-500 mb-1">Font Family</label>
                  <select v-model="bulk.fontFamily" class="bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm">
                    <option value="Arial">Arial</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Courier New">Courier New</option>
                    <option value="Impact">Impact</option>
                  </select>
                </div>
                <div>
                  <label class="block text-[11px] text-gray-500 mb-1">Max Lines</label>
                  <input v-model.number="bulk.maxLines" type="number" min="0" max="10" class="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label class="block text-[11px] text-gray-500 mb-1">Text Color</label>
                  <div class="flex gap-1">
                    <input v-model="bulk.textColor" type="color" class="h-8 w-10 rounded cursor-pointer border border-gray-600" />
                    <input v-model="bulk.textColor" type="text" class="w-24 bg-gray-800 border border-gray-600 rounded px-2 text-xs font-mono uppercase" />
                  </div>
                </div>
              </div>
              <p class="text-[11px] text-gray-500 mt-2">Set values above, then click "Apply to all". Individual layers can still be customized afterwards.</p>
            </div>

            <div v-if="selectedPreset.languages.length === 0" class="text-center text-gray-500 py-8 border border-dashed border-gray-700 rounded-lg">
              <p>No languages added yet. Click "+ Add Language" to start.</p>
            </div>

            <div class="space-y-3">
              <div 
                v-for="(layer, layerIndex) in selectedPreset.languages" 
                :key="layer.id"
                class="bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden"
              >
                <!-- Layer Header -->
                <div 
                  class="flex justify-between items-center px-4 py-2.5 cursor-pointer hover:bg-gray-700/30 transition-colors"
                  @click="toggleLayerExpanded(layer.id)"
                >
                  <div class="flex items-center gap-2">
                    <span class="text-gray-500 text-xs">{{ layerIndex + 1 }}.</span>
                    <span>{{ getLanguageLabel(layer.language) }}</span>
                    <span class="text-xs text-gray-500">— {{ layer.fontSize }}px, ({{ layer.positionX }}%, {{ layer.positionY }}%)</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <button 
                      @click.stop="removeLanguageLayer(layerIndex)" 
                      class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-900/20 transition-colors"
                      title="Remove this language"
                    >
                      🗑️
                    </button>
                    <span class="text-gray-500 text-xs">{{ expandedLayers.has(layer.id) ? '▼' : '▶' }}</span>
                  </div>
                </div>

                <!-- Layer Settings (Expanded) -->
                <div v-if="expandedLayers.has(layer.id)" class="px-4 pb-4 space-y-4 border-t border-gray-700/50">
                  <div class="grid grid-cols-2 gap-4 pt-3">
                    <!-- Language Selection -->
                    <div>
                      <label class="block text-sm text-gray-400 mb-1">Language</label>
                      <select v-model="layer.language" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
                        <option value="live">🎙️ Live Captions (No Translation)</option>
                        <option disabled>─── Common ───</option>
                        <option value="en">🇬🇧 English</option>
                        <option value="tr">🇹🇷 Turkish</option>
                        <option value="de">�� German</option>
                        <option value="fr">🇫🇷 French</option>
                        <option value="es">🇸 Spanish</option>
                        <option value="it">🇮🇹 Italian</option>
                        <option value="pt">🇵🇹 Portuguese</option>
                        <option value="ru">🇷🇺 Russian</option>
                        <option value="ar">🇸🇦 Arabic</option>
                        <option disabled>─── Nordic ───</option>
                        <option value="da">🇩🇰 Danish</option>
                        <option value="sv">🇸🇪 Swedish</option>
                        <option value="no">🇳🇴 Norwegian</option>
                        <option value="fi">🇫🇮 Finnish</option>
                        <option disabled>─── Eastern Europe ───</option>
                        <option value="pl">🇵🇱 Polish</option>
                        <option value="cs">🇨🇿 Czech</option>
                        <option value="sk">🇸🇰 Slovak</option>
                        <option value="hu">🇭🇺 Hungarian</option>
                        <option value="ro">🇷🇴 Romanian</option>
                        <option value="bg">🇧🇬 Bulgarian</option>
                        <option value="hr">🇭🇷 Croatian</option>
                        <option value="sr">🇷🇸 Serbian</option>
                        <option value="sl">🇸🇮 Slovenian</option>
                        <option value="mk">🇲🇰 Macedonian</option>
                        <option value="uk">🇺🇦 Ukrainian</option>
                        <option disabled>─── Western Europe ───</option>
                        <option value="nl">🇳🇱 Dutch</option>
                        <option value="el">🇬🇷 Greek</option>
                        <option value="ca">🇪🇸 Catalan</option>
                        <option disabled>─── Baltic ───</option>
                        <option value="lv">🇱🇻 Latvian</option>
                        <option value="lt">🇱🇹 Lithuanian</option>
                        <option value="et">🇪🇪 Estonian</option>
                        <option disabled>─── Asia ───</option>
                        <option value="ja">🇯🇵 Japanese</option>
                        <option value="ko">🇰🇷 Korean</option>
                        <option value="zh">🇨🇳 Chinese (Simplified)</option>
                        <option value="zh-TW">🇹🇼 Chinese (Traditional)</option>
                        <option value="zh-HK">🇭🇰 Chinese (Cantonese)</option>
                        <option value="hi">🇮🇳 Hindi</option>
                        <option value="th">🇹🇭 Thai</option>
                        <option value="vi">🇻🇳 Vietnamese</option>
                        <option value="id">🇮🇩 Indonesian</option>
                        <option value="ms">🇲🇾 Malay</option>
                        <option value="tl">🇵🇭 Filipino</option>
                        <option value="kk">🇰🇿 Kazakh</option>
                        <option disabled>─── Other ───</option>
                        <option value="he">�� Hebrew</option>
                        <option value="sw">🇰🇪 Swahili</option>
                      </select>
                    </div>

                    <!-- Text Color -->
                    <div>
                      <label class="block text-sm text-gray-400 mb-1">Text Color</label>
                      <div class="flex gap-2">
                        <input v-model="layer.textColor" type="color" class="h-9 w-12 rounded cursor-pointer border border-gray-600" />
                        <input v-model="layer.textColor" type="text" class="flex-1 bg-gray-800 border border-gray-600 rounded px-3 text-sm font-mono uppercase" />
                      </div>
                    </div>

                    <!-- Font Family -->
                    <div>
                      <label class="block text-sm text-gray-400 mb-1">Font Family</label>
                      <select v-model="layer.fontFamily" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm">
                        <option value="Arial">Arial</option>
                        <option value="Verdana">Verdana</option>
                        <option value="Helvetica">Helvetica</option>
                        <option value="Georgia">Georgia</option>
                        <option value="Courier New">Courier New</option>
                        <option value="Impact">Impact</option>
                      </select>
                    </div>

                    <!-- Font Size -->
                    <div>
                      <label class="block text-sm text-gray-400 mb-1">Font Size: <span class="text-blue-400">{{ layer.fontSize }}px</span></label>
                      <input v-model.number="layer.fontSize" type="range" min="12" max="120" class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                    </div>

                    <!-- Position X -->
                    <div>
                      <label class="block text-sm text-gray-400 mb-1">
                        Position X: <span class="text-blue-400">{{ layer.positionX }}%</span>
                      </label>
                      <input v-model.number="layer.positionX" type="range" min="0" max="100" class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                      <p class="text-xs text-gray-500 mt-0.5">0% = Left, 50% = Center, 100% = Right</p>
                    </div>

                    <!-- Position Y -->
                    <div>
                      <label class="block text-sm text-gray-400 mb-1">
                        Position Y: <span class="text-blue-400">{{ layer.positionY }}%</span>
                      </label>
                      <input v-model.number="layer.positionY" type="range" min="0" max="100" class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                      <p class="text-xs text-gray-500 mt-0.5">0% = Top, 50% = Center, 100% = Bottom</p>
                    </div>

                    <!-- Max Lines -->
                    <div>
                      <label class="block text-sm text-gray-400 mb-1">Max Lines (0 = Unlimited)</label>
                      <input v-model.number="layer.maxLines" type="number" min="0" max="10" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" />
                    </div>

                    <!-- Max Width -->
                    <div>
                      <label class="block text-sm text-gray-400 mb-1">Max Width px <span class="text-gray-500">(0 = full screen)</span></label>
                      <input v-model.number="layer.maxWidth" type="number" min="0" step="50" class="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm" placeholder="e.g. 1920" />
                      <p class="text-xs text-gray-500 mt-1">Yan yana diller için piksel genişliği sınırla. 0 = ekran genişliği.</p>
                    </div>
                  </div>
                </div>
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
import AnalogVuMeter from '../components/AnalogVuMeter.vue'

interface LanguageLayer {
  id: string
  language: string          // 'live' | 'en' | 'tr' | 'es' ...
  positionX: number         // 0-100 (%)
  positionY: number         // 0-100 (%)
  fontSize: number
  fontFamily: string
  textColor: string
  maxLines: number
  maxWidth: number          // px, 0 = unlimited (full screen width)
  gridRow?: number          // 0-based assigned grid row (Auto Grid)
  gridCol?: number          // 0-based assigned grid column (Auto Grid)
}

interface WindowStyle {
  backgroundColor: string
  textShadow: boolean
  justifyContent: 'flex-start' | 'center' | 'flex-end'
  backgroundImage?: string     // filename under userData/backgrounds/
  backgroundOpacity?: number   // 0.0 - 1.0 (default 1.0)
}

interface WindowPreset {
  id: string
  name: string
  audioDeviceId?: string
  targetDisplayId?: number
  language?: string  // DEPRECATED: kept for backward compat migration
  languages: LanguageLayer[]
  style: WindowStyle
  outputWidth?: number   // reference output resolution (px) for grid math & preview
  outputHeight?: number
  gridColumns?: number   // Auto Grid settings (persisted per preset)
  gridRows?: number      // 0 = auto
  gridGap?: number
  enabled?: boolean      // false = no STT/translation for this preset (default true)
}

const presets = ref<WindowPreset[]>([])
const activeWindows = ref<Set<string>>(new Set()) // Track IDs of open windows
const isTranscribing = ref(false)
const selectedAudioDeviceId = ref<string>('')
const expandedLayers = ref<Set<string>>(new Set()) // Track which language layers are expanded in editor

// GCP Audio streaming state
let gcpAudioStream: MediaStream | null = null
let gcpAudioContext: AudioContext | null = null
let gcpScriptProcessor: ScriptProcessorNode | null = null

const audioDevices = ref<MediaDeviceInfo[]>([])
const displays = ref<any[]>([])

const selectedPresetId = ref<string | null>(null)
const selectedPreset = computed(() => presets.value.find(p => p.id === selectedPresetId.value))

// Background image preview URL (file://) for the selected preset
const bgImageUrl = ref<string | null>(null)

// Auto Grid inputs — backed by the selected preset so they persist on save
const gridColumns = computed({
  get: () => selectedPreset.value?.gridColumns ?? 4,
  set: (v) => { if (selectedPreset.value) selectedPreset.value.gridColumns = v }
})
const gridRows = computed({
  get: () => selectedPreset.value?.gridRows ?? 0,   // 0 = auto (ceil(count / columns))
  set: (v) => { if (selectedPreset.value) selectedPreset.value.gridRows = v }
})
const gridGap = computed({
  get: () => selectedPreset.value?.gridGap ?? 10,
  set: (v) => { if (selectedPreset.value) selectedPreset.value.gridGap = v }
})
const showGridLines = ref(true)  // overlay cell borders on the preview (UI-only)

// Bulk style applied to all language layers at once
const bulk = ref({ fontSize: 48, fontFamily: 'Arial', textColor: '#FFFFFF', maxLines: 4 })

// Effective row count used by the grid (explicit if set, else auto)
const effectiveGridRows = computed(() => {
  const count = selectedPreset.value?.languages.length ?? 0
  const cols = Math.max(1, Math.floor(gridColumns.value))
  return gridRows.value > 0 ? Math.floor(gridRows.value) : Math.max(1, Math.ceil(count / cols))
})

// OBS URL copy feedback (preset id that was just copied)
const obsCopiedId = ref<string | null>(null)

// ── Output dimensions ────────────────────────────────────────────────────────
// The reference output resolution (the OBS Browser Source / capture size). This
// is what drives the grid's pixel widths and the preview aspect ratio. It is
// independent of any physical display — for OBS capture there is no display.
// Priority: explicit preset value → selected target display → 1920×1080 default.
const outputWidth = computed(() => {
  if (selectedPreset.value?.outputWidth && selectedPreset.value.outputWidth > 0) return selectedPreset.value.outputWidth
  const d = displays.value.find(x => x.id === selectedPreset.value?.targetDisplayId)
  return d?.bounds?.width ?? 1920
})
const outputHeight = computed(() => {
  if (selectedPreset.value?.outputHeight && selectedPreset.value.outputHeight > 0) return selectedPreset.value.outputHeight
  const d = displays.value.find(x => x.id === selectedPreset.value?.targetDisplayId)
  return d?.bounds?.height ?? 1080
})

// Preview uses the output dimensions
const previewScreenWidth = computed(() => outputWidth.value)
const previewAspectRatio = computed(() => `${outputWidth.value} / ${outputHeight.value}`)

onMounted(async () => {
  await getAudioDevices()
  navigator.mediaDevices.ondevicechange = getAudioDevices
  await getDisplays()
  await loadPresets()

  // Sync each preset's enabled/disabled state to the main process
  for (const p of presets.value) {
    window.ipcRenderer.invoke('set-preset-enabled', { id: p.id, enabled: p.enabled !== false })
  }

  // Sync active windows
  const activeIds = await window.ipcRenderer.invoke('get-active-windows')
  activeWindows.value = new Set(activeIds)
  
  // Initialize VU Meter device
  const settings = await window.ipcRenderer.invoke('get-settings', 'transcription')
  if (settings && settings.audioDeviceId) {
    selectedAudioDeviceId.value = settings.audioDeviceId
  } else if (audioDevices.value.length > 0) {
    // Fallback to first available device if no setting
    selectedAudioDeviceId.value = audioDevices.value[0].deviceId
  }
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

const getLanguageLabel = (code?: string) => {
  const languages: Record<string, string> = {
    'live': '🎙️ Live',
    'en': '🇬🇧 English',
    'tr': '🇹🇷 Turkish',
    'de': '�� German',
    'fr': '🇫🇷 French',
    'es': '🇸 Spanish',
    'it': '🇮🇹 Italian',
    'pt': '🇵🇹 Portuguese',
    'ru': '🇷🇺 Russian',
    'ar': '🇸🇦 Arabic',
    'da': '🇩🇰 Danish',
    'sv': '🇸🇪 Swedish',
    'no': '🇳🇴 Norwegian',
    'fi': '🇫🇮 Finnish',
    'pl': '🇵🇱 Polish',
    'cs': '🇨🇿 Czech',
    'sk': '🇸🇰 Slovak',
    'hu': '🇭🇺 Hungarian',
    'ro': '🇷🇴 Romanian',
    'bg': '🇧🇬 Bulgarian',
    'hr': '🇭🇷 Croatian',
    'sr': '🇷🇸 Serbian',
    'sl': '🇸🇮 Slovenian',
    'mk': '🇲🇰 Macedonian',
    'uk': '🇺🇦 Ukrainian',
    'nl': '🇳🇱 Dutch',
    'el': '🇬🇷 Greek',
    'ca': '🇪🇸 Catalan',
    'lv': '🇱🇻 Latvian',
    'lt': '🇱🇹 Lithuanian',
    'et': '🇪🇪 Estonian',
    'ja': '🇯🇵 Japanese',
    'ko': '🇰🇷 Korean',
    'zh': '🇨🇳 Chinese',
    'zh-TW': '🇹🇼 Chinese (TW)',
    'zh-HK': '🇭🇰 Cantonese',
    'hi': '🇮🇳 Hindi',
    'th': '🇹🇭 Thai',
    'vi': '🇻🇳 Vietnamese',
    'id': '🇮🇩 Indonesian',
    'ms': '🇲🇾 Malay',
    'tl': '🇵🇭 Filipino',
    'kk': '🇰🇿 Kazakh',
    'he': '🇮🇱 Hebrew',
    'sw': '�� Swahili',
  }
  return languages[code || 'live'] || code || '🎙️ Live'
}

const getLanguageSummary = (preset: WindowPreset) => {
  if (!preset.languages || preset.languages.length === 0) return 'No languages'
  return preset.languages.map(l => getLanguageLabel(l.language)).join(', ')
}

const toggleLayerExpanded = (layerId: string) => {
  if (expandedLayers.value.has(layerId)) {
    expandedLayers.value.delete(layerId)
  } else {
    expandedLayers.value.add(layerId)
  }
}

const createDefaultLayer = (language: string = 'live', positionY: number = 50): LanguageLayer => ({
  id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
  language,
  positionX: 50,
  positionY,
  fontSize: 48,
  fontFamily: 'Arial',
  textColor: '#FFFFFF',
  maxLines: 4,
  maxWidth: 0,
})

const addLanguageLayer = () => {
  if (!selectedPreset.value) return
  const existingCount = selectedPreset.value.languages.length
  // Stagger Y position: 30%, 50%, 70%, etc.
  const yPosition = existingCount === 0 ? 50 : Math.min(30 + existingCount * 20, 90)
  const newLayer = createDefaultLayer('live', yPosition)
  selectedPreset.value.languages.push(newLayer)
  expandedLayers.value.add(newLayer.id)
}

const removeLanguageLayer = (index: number) => {
  if (!selectedPreset.value) return
  const layer = selectedPreset.value.languages[index]
  if (layer) expandedLayers.value.delete(layer.id)
  selectedPreset.value.languages.splice(index, 1)
}

onUnmounted(() => {
  // Stop GCP if active
  stopGcpAudioCapture()
})

const loadPresets = async () => {
  const saved = await window.ipcRenderer.invoke('get-project-state') as any[]
  if (saved && saved.length > 0) {
    // Migrate old presets: convert single language + style fields → languages[] array
    presets.value = saved.map((p: any) => {
      // Already migrated preset
      if (Array.isArray(p.languages) && p.languages.length > 0) {
        return {
          ...p,
          style: {
            backgroundColor: p.style?.backgroundColor ?? '#00FF00',
            textShadow: p.style?.textShadow ?? true,
            justifyContent: p.style?.justifyContent ?? 'center',
            backgroundImage: p.style?.backgroundImage,
            backgroundOpacity: p.style?.backgroundOpacity ?? 1,
          }
        } as WindowPreset
      }
      
      // Legacy preset: migrate single language + style → languages[]
      const migratedLayer: LanguageLayer = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
        language: p.language ?? 'live',
        positionX: p.style?.positionX ?? 50,
        positionY: p.style?.positionY ?? 50,
        fontSize: p.style?.fontSize ?? 48,
        fontFamily: p.style?.fontFamily ?? 'Arial',
        textColor: p.style?.textColor ?? '#FFFFFF',
        maxLines: p.style?.maxLines ?? 4,
        maxWidth: p.style?.maxWidth ?? 0,
      }
      
      return {
        id: p.id,
        name: p.name,
        audioDeviceId: p.audioDeviceId,
        targetDisplayId: p.targetDisplayId,
        languages: [migratedLayer],
        style: {
          backgroundColor: p.style?.backgroundColor ?? '#00FF00',
          textShadow: p.style?.textShadow ?? true,
          justifyContent: p.style?.justifyContent ?? 'center',
          backgroundImage: p.style?.backgroundImage,
          backgroundOpacity: p.style?.backgroundOpacity ?? 1,
        }
      } as WindowPreset
    })
  }
}

const savePresetsToDisk = async () => {
  await window.ipcRenderer.invoke('save-project-state', JSON.parse(JSON.stringify(presets.value)))
}

// Export all presets to a JSON file (for transfer to another machine)
const exportPresets = async () => {
  const res = await window.ipcRenderer.invoke('export-presets', JSON.parse(JSON.stringify(presets.value)))
  if (res?.ok) {
    alert(`Exported ${presets.value.length} preset(s) to:\n${res.path}`)
  } else if (res?.error) {
    alert(`Export failed: ${res.error}`)
  }
}

// Import presets from a JSON file (appended with fresh ids so nothing is overwritten)
const importPresets = async () => {
  const res = await window.ipcRenderer.invoke('import-presets')
  if (!res?.ok) {
    if (res?.error) alert(`Import failed: ${res.error}`)
    return
  }
  const incoming = (res.presets || []) as any[]
  let added = 0
  for (const p of incoming) {
    if (!p || !Array.isArray(p.languages)) continue
    const newPreset: WindowPreset = {
      ...p,
      id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
      name: p.name || `Imported ${presets.value.length + 1}`,
      style: {
        backgroundColor: p.style?.backgroundColor ?? '#00FF00',
        textShadow: p.style?.textShadow ?? true,
        justifyContent: p.style?.justifyContent ?? 'center',
        backgroundImage: p.style?.backgroundImage,
        backgroundOpacity: p.style?.backgroundOpacity ?? 1,
      },
    }
    presets.value.push(newPreset)
    added++
  }
  if (added > 0) {
    selectedPresetId.value = presets.value[presets.value.length - 1].id
    savePresetsToDisk()
  }
  alert(`${added} preset(s) imported.`)
}

const createNewPreset = () => {
  const defaultLayer = createDefaultLayer('live', 50)
  const newPreset: WindowPreset = {
    id: Date.now().toString(),
    name: `Preset ${presets.value.length + 1}`,
    languages: [defaultLayer],
    style: {
      backgroundColor: '#00FF00',
      textShadow: true,
      justifyContent: 'center',
      backgroundOpacity: 1,
    }
  }
  presets.value.push(newPreset)
  selectedPresetId.value = newPreset.id
  expandedLayers.value.add(defaultLayer.id)
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
    const plainLanguages = JSON.parse(JSON.stringify(preset.languages))
    
    // Send style + languages update
    window.ipcRenderer.invoke('update-projection-settings', { 
      id: preset.id, 
      style: plainStyle,
      languages: plainLanguages,
      title: preset.name
    })
    // Send audio update
    if (preset.audioDeviceId) {
      window.ipcRenderer.invoke('update-projection-settings', { 
        id: preset.id, 
        audioDeviceId: preset.audioDeviceId 
      })
    }
}

// Push style/layers to connected OBS clients (works even with no open window)
const updateObsConfig = (preset: WindowPreset) => {
  window.ipcRenderer.invoke('push-obs-config', {
    id: preset.id,
    style: JSON.parse(JSON.stringify(preset.style)),
    languages: JSON.parse(JSON.stringify(preset.languages))
  })
}

// Enable/disable a preset. Disabled = excluded from STT/translation broadcasting
// (no credit/token use). Disabling also closes its open window so nothing keeps running.
const togglePresetEnabled = async (preset: WindowPreset) => {
  const enabled = !(preset.enabled !== false)  // currently-enabled (true/undefined) → false
  preset.enabled = enabled
  savePresetsToDisk()
  await window.ipcRenderer.invoke('set-preset-enabled', { id: preset.id, enabled })
  if (!enabled && activeWindows.value.has(preset.id)) {
    await closeWindow(preset.id)
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
    await window.ipcRenderer.invoke('create-projection-window', { 
      id: preset.id, 
      title: preset.name 
    })
    activeWindows.value.add(preset.id)
    
    // Set language layers for this window (multi-language)
    await window.ipcRenderer.invoke('set-window-languages', {
      windowId: preset.id,
      languages: JSON.parse(JSON.stringify(preset.languages))
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
  resolveSelectedBg()
}

// ── Background Image ─────────────────────────────────────────────────────────
const resolveSelectedBg = async () => {
  const file = selectedPreset.value?.style.backgroundImage
  if (file) {
    try {
      bgImageUrl.value = await window.ipcRenderer.invoke('get-background-image-path', file)
    } catch {
      bgImageUrl.value = null
    }
  } else {
    bgImageUrl.value = null
  }
}

const selectBackgroundImage = async () => {
  if (!selectedPreset.value) return
  const filename = await window.ipcRenderer.invoke('select-background-image')
  if (filename) {
    selectedPreset.value.style.backgroundImage = filename
    if (typeof selectedPreset.value.style.backgroundOpacity !== 'number') {
      selectedPreset.value.style.backgroundOpacity = 1
    }
    await resolveSelectedBg()
    savePresetsToDisk()
  }
}

const removeBackgroundImage = () => {
  if (!selectedPreset.value) return
  selectedPreset.value.style.backgroundImage = undefined
  bgImageUrl.value = null
  savePresetsToDisk()
}

// ── Auto Grid Layout ─────────────────────────────────────────────────────────
// Core grid layout: honors each layer's explicit (gridRow, gridCol) assignment,
// then fills any unassigned layers into the remaining free cells (row-major).
// Finally derives positionX/Y/maxWidth so it aligns with a same-size bordered
// background image divided into the same columns × rows.
const recomputeGridPositions = () => {
  if (!selectedPreset.value) return
  const layers = selectedPreset.value.languages
  if (layers.length === 0) { savePresetsToDisk(); return }

  const columns = Math.max(1, Math.floor(gridColumns.value))
  const rows = effectiveGridRows.value
  const gap = Math.max(0, Math.floor(gridGap.value))
  const cellWidthPct = 100 / columns
  const cellHeightPct = 100 / rows

  const maxWidthPx = Math.max(0, Math.floor(outputWidth.value / columns) - gap)

  // Collect valid explicit assignments; drop out-of-range ones
  const occupied = new Set<string>()
  for (const l of layers) {
    const validCol = Number.isInteger(l.gridCol) && l.gridCol! >= 0 && l.gridCol! < columns
    const validRow = Number.isInteger(l.gridRow) && l.gridRow! >= 0 && l.gridRow! < rows
    if (validCol && validRow) {
      occupied.add(`${l.gridRow}-${l.gridCol}`)
    } else {
      l.gridRow = undefined
      l.gridCol = undefined
    }
  }

  // Fill unassigned layers into free cells, row-major
  let cellIdx = 0
  const totalCells = columns * rows
  const nextFreeCell = () => {
    while (cellIdx < totalCells) {
      const r = Math.floor(cellIdx / columns)
      const c = cellIdx % columns
      cellIdx++
      if (!occupied.has(`${r}-${c}`)) return { r, c }
    }
    return null
  }
  for (const l of layers) {
    if (l.gridRow == null || l.gridCol == null) {
      const free = nextFreeCell()
      if (free) {
        l.gridRow = free.r
        l.gridCol = free.c
        occupied.add(`${free.r}-${free.c}`)
      }
    }
  }

  // Derive positions from assigned cells
  for (const l of layers) {
    if (l.gridRow == null || l.gridCol == null) continue
    l.positionX = Math.round((l.gridCol + 0.5) * cellWidthPct * 100) / 100
    l.positionY = Math.round((l.gridRow + 0.5) * cellHeightPct * 100) / 100
    l.maxWidth = maxWidthPx
  }
  savePresetsToDisk()
}

const applyAutoGrid = () => recomputeGridPositions()

// Copy the selected target display's resolution into the output size fields
const useDisplaySizeForOutput = () => {
  const d = displays.value.find(x => x.id === selectedPreset.value?.targetDisplayId)
  if (d?.bounds && selectedPreset.value) {
    selectedPreset.value.outputWidth = d.bounds.width
    selectedPreset.value.outputHeight = d.bounds.height
    savePresetsToDisk()
  }
}

// Which layer (id) currently occupies a given cell
const cellLayerId = (row: number, col: number): string => {
  const l = selectedPreset.value?.languages.find(x => x.gridRow === row && x.gridCol === col)
  return l?.id || ''
}

// Assign (or clear) the language layer occupying a cell. Swaps if the chosen
// layer was already placed elsewhere.
const assignCell = (row: number, col: number, layerId: string) => {
  if (!selectedPreset.value) return
  const layers = selectedPreset.value.languages
  const occupant = layers.find(l => l.gridRow === row && l.gridCol === col) || null

  if (!layerId) {
    // Clear this cell
    if (occupant) { occupant.gridRow = undefined; occupant.gridCol = undefined }
  } else {
    const newLayer = layers.find(l => l.id === layerId)
    if (!newLayer) return
    const oldRow = newLayer.gridRow
    const oldCol = newLayer.gridCol
    newLayer.gridRow = row
    newLayer.gridCol = col
    // Swap the displaced layer into the chosen layer's old cell
    if (occupant && occupant.id !== newLayer.id) {
      occupant.gridRow = oldRow
      occupant.gridCol = oldCol
    }
  }
  recomputeGridPositions()
}

const onCellChange = (row: number, col: number, event: Event) => {
  assignCell(row, col, (event.target as HTMLSelectElement).value)
}

// Apply the bulk style values to every layer at once (only on button click,
// so individual per-layer tweaks made afterwards are preserved).
const applyBulkToAll = () => {
  if (!selectedPreset.value) return
  selectedPreset.value.languages.forEach((l) => {
    l.fontSize = bulk.value.fontSize
    l.fontFamily = bulk.value.fontFamily
    l.textColor = bulk.value.textColor
    l.maxLines = bulk.value.maxLines
  })
  savePresetsToDisk()
}

const resetPositions = () => {
  if (!selectedPreset.value) return
  selectedPreset.value.languages.forEach((layer) => {
    layer.positionX = 50
    layer.positionY = 50
    layer.maxWidth = 0
    layer.gridRow = undefined
    layer.gridCol = undefined
  })
  savePresetsToDisk()
}

// ── Preview layer styling (uses container-query units so text scales with the box) ──
const previewLayerStyle = (layer: LanguageLayer): Record<string, string> => {
  const widthPct = layer.maxWidth > 0 ? Math.min((layer.maxWidth / previewScreenWidth.value) * 100, 100) : null
  return {
    position: 'absolute',
    left: `${layer.positionX}%`,
    top: `${layer.positionY}%`,
    transform: 'translate(-50%, -50%)',
    width: widthPct != null ? `${widthPct}%` : 'auto',
    maxWidth: '100%',
    textAlign: 'center',
    overflow: 'hidden',
  }
}
const previewTextStyle = (layer: LanguageLayer): Record<string, string> => ({
  // Scale font relative to the real screen width via container-query width units
  fontSize: `${(layer.fontSize / previewScreenWidth.value) * 100}cqw`,
  fontFamily: layer.fontFamily,
  color: layer.textColor,
  lineHeight: '1.15',
  textShadow: selectedPreset.value?.style.textShadow ? '1px 1px 2px rgba(0,0,0,0.8)' : 'none',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
})
const selectLayerFromPreview = (layer: LanguageLayer) => {
  expandedLayers.value.add(layer.id)
}

// ── OBS Output URL ───────────────────────────────────────────────────────────
const copyObsUrl = async (preset: WindowPreset) => {
  try {
    const url = await window.ipcRenderer.invoke('get-obs-url', { presetId: preset.id })
    await navigator.clipboard.writeText(url)
    obsCopiedId.value = preset.id
    setTimeout(() => {
      if (obsCopiedId.value === preset.id) obsCopiedId.value = null
    }, 2000)
  } catch (e) {
    console.error('Failed to copy OBS URL:', e)
  }
}

const toggleTranscription = async () => {
  const settings = await window.ipcRenderer.invoke('get-settings', 'transcription')
  const provider = settings?.sttProvider || settings?.provider || 'GCP'
  
  if (isTranscribing.value) {
    // Stop transcription based on provider
    if (provider === 'GCP') {
      await window.ipcRenderer.invoke('stop-gcp-transcription')
      stopGcpAudioCapture()
    } else if (provider === 'LOCAL') {
      await window.ipcRenderer.invoke('stop-local-transcription')
    } else if (provider === 'SHERPA_ONNX') {
      await window.ipcRenderer.invoke('stop-sherpa-transcription')
      stopGcpAudioCapture() // same audio capture mechanism
    } else if (provider === 'RIVA') {
      await window.ipcRenderer.invoke('stop-riva-transcription')
      stopGcpAudioCapture()
    } else if (provider === 'DEEPGRAM') {
      await window.ipcRenderer.invoke('stop-deepgram-transcription')
      stopGcpAudioCapture()
    }
    isTranscribing.value = false
  } else {
    // Pre-initialize NLLB if it's the selected translation provider
    if (settings?.translationProvider === 'NLLB') {
      try {
        await window.ipcRenderer.invoke('initialize-nllb', false)
      } catch (e) {
        console.error('Failed to init NLLB:', e)
        alert('NLLB model failed to initialize or download required. Please try checking Settings or your model path.')
      }
    }

    // Start transcription based on provider
    if (provider === 'GCP') {
      await window.ipcRenderer.invoke('start-gcp-transcription', {
        gcpKeyJson: settings?.gcpKeyJson || '',
        languages: settings?.recognitionLanguages || ['en'],
        gcpModel: settings?.gcpModel || 'latest_long',
        gcpEncoding: settings?.gcpEncoding || 'LINEAR16',
        gcpInterimResults: settings?.gcpInterimResults ?? true,
        gcpAutoPunctuation: settings?.gcpAutoPunctuation ?? true,
        gcpUseEnhanced: settings?.gcpUseEnhanced ?? false,
        gcpSingleUtterance: settings?.gcpSingleUtterance ?? false,
        gcpMaxAlternatives: settings?.gcpMaxAlternatives ?? 1,
        gcpConfidenceThreshold: settings?.gcpConfidenceThreshold ?? 0.85,
        gcpMinWordBuffer: settings?.gcpMinWordBuffer ?? 3,
        gcpProfanityFilter: settings?.gcpProfanityFilter ?? false
      })
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
    } else if (provider === 'SHERPA_ONNX') {
      const sherpaModel = settings?.sherpaModel || ''
      if (!sherpaModel) {
        alert('Please select and download a Sherpa-ONNX model in Settings first.')
        return
      }
      const modelPath = await window.ipcRenderer.invoke('get-sherpa-model-path', sherpaModel)
      await window.ipcRenderer.invoke('start-sherpa-transcription', {
        modelDir: modelPath,
        language: settings?.language || 'auto',
        sampleRate: 16000
      })
      // Start audio capture — same as GCP but sends to 'sherpa-audio-chunk'
      await startSherpaAudioCapture()
      isTranscribing.value = true
    } else if (provider === 'RIVA') {
      await window.ipcRenderer.invoke('start-riva-transcription', {
        serverUrl: settings?.rivaServerUrl || 'localhost:50051',
        language: settings?.language || 'en-US',
        sampleRate: 16000
      })
      await startRivaAudioCapture()
      isTranscribing.value = true
    } else if (provider === 'DEEPGRAM') {
      await window.ipcRenderer.invoke('start-deepgram-transcription', {
        deepgramApiKey: settings?.deepgramApiKey || '',
        languages: settings?.recognitionLanguages || ['en'],
        deepgramModel: settings?.deepgramModel || 'nova-3',
        deepgramLanguage: settings?.deepgramLanguage || 'multi',
        deepgramPunctuate: settings?.deepgramPunctuate ?? true,
        deepgramDiarize: settings?.deepgramDiarize ?? false,
        deepgramUtterances: settings?.deepgramUtterances ?? true,
        deepgramInterimResults: settings?.deepgramInterimResults ?? true,
        deepgramEndpointing: settings?.deepgramEndpointing ?? 300,
        deepgramSmartFormat: settings?.deepgramSmartFormat ?? true,
        deepgramProfanityFilter: settings?.deepgramProfanityFilter ?? false,
        deepgramUtteranceEndMs: settings?.deepgramUtteranceEndMs ?? 1000,
        deepgramNoDelay: settings?.deepgramNoDelay ?? true,
        deepgramEncoding: settings?.deepgramEncoding || 'linear16',
        deepgramFillerWords: settings?.deepgramFillerWords ?? false,
        deepgramKeywords: settings?.deepgramKeywords || '',
        deepgramMaxSentences: settings?.subtitleMaxSentences ?? 1,
      })
      await startDeepgramAudioCapture()
      isTranscribing.value = true
    } else if (provider === 'AWS' || provider === 'MOCK') {
      isTranscribing.value = true
    }
  }
}

// GCP Audio capture functions
const startGcpAudioCapture = async () => {
  try {
    gcpAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedAudioDeviceId.value ? { exact: selectedAudioDeviceId.value } : undefined,
        sampleRate: 16000, 
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
      // Convert Float32Array to Int16Array
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
  console.log('Audio capture stopped')
}

// Sherpa-ONNX audio capture — same as GCP but sends to 'sherpa-audio-chunk'
const startSherpaAudioCapture = async () => {
  try {
    gcpAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedAudioDeviceId.value ? { exact: selectedAudioDeviceId.value } : undefined,
        sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true
      }
    })
    gcpAudioContext = new AudioContext({ sampleRate: 16000 })
    const source = gcpAudioContext.createMediaStreamSource(gcpAudioStream)
    gcpScriptProcessor = gcpAudioContext.createScriptProcessor(4096, 1, 1)
    gcpScriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0)
      const int16Data = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }
      window.ipcRenderer.send('sherpa-audio-chunk', int16Data.buffer)
    }
    source.connect(gcpScriptProcessor)
    gcpScriptProcessor.connect(gcpAudioContext.destination)
    console.log('Sherpa-ONNX audio capture started')
  } catch (error) {
    console.error('Failed to start Sherpa audio capture:', error)
  }
}

// Riva audio capture — same as GCP but sends to 'riva-audio-chunk'
const startRivaAudioCapture = async () => {
  try {
    gcpAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedAudioDeviceId.value ? { exact: selectedAudioDeviceId.value } : undefined,
        sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true
      }
    })
    gcpAudioContext = new AudioContext({ sampleRate: 16000 })
    const source = gcpAudioContext.createMediaStreamSource(gcpAudioStream)
    gcpScriptProcessor = gcpAudioContext.createScriptProcessor(4096, 1, 1)
    gcpScriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0)
      const int16Data = new Int16Array(inputData.length)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }
      window.ipcRenderer.send('riva-audio-chunk', int16Data.buffer)
    }
    source.connect(gcpScriptProcessor)
    gcpScriptProcessor.connect(gcpAudioContext.destination)
    console.log('Riva audio capture started')
  } catch (error) {
    console.error('Failed to start Riva audio capture:', error)
  }
}

// Deepgram audio capture — uses small buffer + accumulation for configurable chunk size
let deepgramAccumulatedSamples: Int16Array | null = null
let deepgramAccumulatedOffset = 0

const startDeepgramAudioCapture = async () => {
  const settings = await window.ipcRenderer.invoke('get-settings', 'transcription')
  const chunkMs = settings?.deepgramChunkMs ?? 50 // default 50ms
  const sampleRate = 16000
  const targetSamples = Math.floor(sampleRate * chunkMs / 1000) // e.g. 50ms → 800 samples

  // Pre-allocate accumulation buffer
  deepgramAccumulatedSamples = new Int16Array(targetSamples)
  deepgramAccumulatedOffset = 0

  try {
    gcpAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedAudioDeviceId.value ? { exact: selectedAudioDeviceId.value } : undefined,
        sampleRate: sampleRate, channelCount: 1, echoCancellation: true, noiseSuppression: true
      }
    })
    gcpAudioContext = new AudioContext({ sampleRate: sampleRate })
    const source = gcpAudioContext.createMediaStreamSource(gcpAudioStream)
    // Use smallest valid buffer for fine-grained accumulation
    gcpScriptProcessor = gcpAudioContext.createScriptProcessor(256, 1, 1)
    gcpScriptProcessor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0)
      for (let i = 0; i < inputData.length; i++) {
        const s = Math.max(-1, Math.min(1, inputData[i]))
        deepgramAccumulatedSamples![deepgramAccumulatedOffset++] = s < 0 ? s * 0x8000 : s * 0x7FFF
        // When target chunk is full, send and reset
        if (deepgramAccumulatedOffset >= targetSamples) {
          window.ipcRenderer.send('deepgram-audio-chunk', deepgramAccumulatedSamples!.buffer.slice(0))
          deepgramAccumulatedOffset = 0
        }
      }
    }
    source.connect(gcpScriptProcessor)
    gcpScriptProcessor.connect(gcpAudioContext.destination)
    console.log(`Deepgram audio capture started (chunk: ${chunkMs}ms = ${targetSamples} samples)`)
  } catch (error) {
    console.error('Failed to start Deepgram audio capture:', error)
  }
}

// Watch for changes in selected preset to auto-update live window (Real-time styling)
// Debounced to prevent IPC flood on every keystroke (fixes Windows input focus loss)
let watchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(() => selectedPreset.value, (newVal) => {
  if (!newVal) return
  if (watchDebounceTimer) clearTimeout(watchDebounceTimer)
  watchDebounceTimer = setTimeout(() => {
    if (activeWindows.value.has(newVal.id)) updateLiveWindow(newVal)
    // Always push to OBS — broadcast is a no-op if no client is subscribed
    updateObsConfig(newVal)
  }, 300)
}, { deep: true })

// Re-resolve background image preview when the selected preset or its image changes
watch(() => selectedPreset.value?.style.backgroundImage, () => {
  resolveSelectedBg()
})

</script>
