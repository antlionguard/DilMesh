<template>
  <div class="analog-vu-meter flex flex-col gap-1 w-full p-2 bg-black/40 rounded-lg border border-gray-800 shadow-inner">
    <!-- Left Channel -->
    <div class="channel-row flex items-center gap-2 h-4">
      <span class="channel-label text-[10px] font-mono font-bold text-gray-500 w-4 text-center">L</span>
      <div class="meter-bar flex-1 flex gap-[2px] h-full bg-gray-900/80 rounded overflow-hidden relative border border-gray-800">
        <div 
          v-for="n in totalSegments" 
          :key="`L-${n}`"
          class="segment flex-1 h-full rounded-[1px] transition-colors duration-75"
          :class="getSegmentClass(n, volumeL, peakL)"
        ></div>
      </div>
    </div>

    <!-- Right Channel -->
    <div class="channel-row flex items-center gap-2 h-4">
      <span class="channel-label text-[10px] font-mono font-bold text-gray-500 w-4 text-center">R</span>
      <div class="meter-bar flex-1 flex gap-[2px] h-full bg-gray-900/80 rounded overflow-hidden relative border border-gray-800">
        <div 
          v-for="n in totalSegments" 
          :key="`R-${n}`"
          class="segment flex-1 h-full rounded-[1px] transition-colors duration-75"
          :class="getSegmentClass(n, volumeR, peakR)"
        ></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps<{
  deviceId?: string
}>()

const totalSegments = 30
const volumeL = ref(0) // 0-100
const volumeR = ref(0) // 0-100
const peakL = ref(0)   // 0-100 (Peak hold)
const peakR = ref(0)   // 0-100 (Peak hold)

let audioContext: AudioContext | null = null
let mediaStream: MediaStream | null = null
let source: MediaStreamAudioSourceNode | null = null
let splitter: ChannelSplitterNode | null = null
let analyserL: AnalyserNode | null = null
let analyserR: AnalyserNode | null = null
let animationFrame: number | null = null
let peakTimerL: any = null
let peakTimerR: any = null

const FFT_SIZE = 2048 // Time domain

const getSegmentClass = (n: number, volume: number, peakHold: number) => {
  const percent = (n / totalSegments) * 100
  const segmentSize = 100 / totalSegments
  
  // Is this segment lit by volume?
  const isLit = volume >= percent
  
  // Is this segment the peak?
  const isPeak = (peakHold >= percent) && (peakHold < (percent + segmentSize))
  
  // Base off color
  if (!isLit && !isPeak) return 'bg-gray-800/40'
  
  // Determine color based on position
  let colorClass = ''
  if (percent >= 85) colorClass = 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.8)]'
  else if (percent >= 60) colorClass = 'bg-yellow-400 shadow-[0_0_4px_rgba(250,204,21,0.8)]'
  else colorClass = 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.8)]'
  
  if (isPeak) {
     // Peak is always bright, maybe slightly different shade or opacity if needed
     // Return just the color but ensure opacity is high
     return colorClass + ' opacity-100 z-10 scale-105'
  }
  
  return isLit ? colorClass : 'bg-gray-800'
}

const startMonitoring = async () => {
  stopVUMeter()

  if (!props.deviceId) return

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: props.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2
      }
    })

    audioContext = new AudioContext()
    source = audioContext.createMediaStreamSource(mediaStream)
    analyserL = audioContext.createAnalyser()
    analyserR = audioContext.createAnalyser()
    
    analyserL.fftSize = FFT_SIZE
    analyserR.fftSize = FFT_SIZE
    
    // Attempt stereo split
    const track = mediaStream.getAudioTracks()[0]
    const settings = track.getSettings()
    // Most mics are mono, so we duplicate mono to L/R if needed
    // If we have 2 channels, we split.
    
    if (settings.channelCount && settings.channelCount >= 2) {
       splitter = audioContext.createChannelSplitter(2)
       source.connect(splitter)
       splitter.connect(analyserL, 0)
       splitter.connect(analyserR, 1)
    } else {
       // Mono source
       source.connect(analyserL)
       source.connect(analyserR)
    }

    draw()
  } catch (err) {
    console.error('Error starting VU meter:', err)
  }
}

const stopVUMeter = () => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop())
    mediaStream = null
  }
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
  source = null
  splitter = null
  analyserL = null
  analyserR = null
  
  volumeL.value = 0
  volumeR.value = 0
  peakL.value = 0
  peakR.value = 0
}

const calculateRMS = (data: Uint8Array) => {
  let sum = 0
  // data is 0..255, 128 is 0
  for (let i = 0; i < data.length; i++) {
    const amplitude = (data[i] - 128) / 128
    sum += amplitude * amplitude
  }
  const rms = Math.sqrt(sum / data.length)
  return rms
}

const MAX_DB = -3 // Clipping
const MIN_DB = -60 // Silence

const draw = () => {
  if (!analyserL || !analyserR) return

  const bufferLength = analyserL.frequencyBinCount
  const dataL = new Uint8Array(bufferLength)
  const dataR = new Uint8Array(bufferLength)

  analyserL.getByteTimeDomainData(dataL)
  analyserR.getByteTimeDomainData(dataR)

  const rmsL = calculateRMS(dataL)
  const rmsR = calculateRMS(dataR)

  // Convert to dB
  const dbL = 20 * Math.log10(rmsL || 0.00001)
  const dbR = 20 * Math.log10(rmsR || 0.00001)
  
  // Map dB to 0-100%
  const mapDbToPercent = (db: number) => {
      const normalized = (db - MIN_DB) / (MAX_DB - MIN_DB)
      return Math.max(0, Math.min(100, normalized * 100))
  }

  const targetL = mapDbToPercent(dbL)
  const targetR = mapDbToPercent(dbR)

  // Smooth decay for volume bar
  const decay = 0.8
  volumeL.value = Math.max(targetL, volumeL.value * decay)
  volumeR.value = Math.max(targetR, volumeR.value * decay)

  // Peak Logic
  updatePeak(targetL, 'L')
  updatePeak(targetR, 'R')

  animationFrame = requestAnimationFrame(draw)
}

const updatePeak = (val: number, channel: 'L' | 'R') => {
  if (channel === 'L') {
    if (val > peakL.value) {
      peakL.value = val
      if (peakTimerL) clearTimeout(peakTimerL)
      peakTimerL = setTimeout(() => dropPeak('L'), 800)
    }
  } else {
    if (val > peakR.value) {
      peakR.value = val
      if (peakTimerR) clearTimeout(peakTimerR)
      peakTimerR = setTimeout(() => dropPeak('R'), 800)
    }
  }
}

const dropPeak = (channel: 'L' | 'R') => {
  if (channel === 'L') {
    // Linear drop
    if (peakL.value > 0) {
      peakL.value = Math.max(0, peakL.value - 2)
      requestAnimationFrame(() => dropPeak('L'))
    }
  } else {
    if (peakR.value > 0) {
      peakR.value = Math.max(0, peakR.value - 2)
      requestAnimationFrame(() => dropPeak('R'))
    }
  }
}

watch(() => props.deviceId, (newVal) => {
  if (newVal) startMonitoring()
  else stopVUMeter()
})

onMounted(() => {
  startMonitoring()
})

onUnmounted(() => {
  stopVUMeter()
})
</script>

<style scoped>
.segment {
  /* Subtle separation */
  box-shadow: inset 1px 1px 2px rgba(0,0,0,0.2);
}
</style>
