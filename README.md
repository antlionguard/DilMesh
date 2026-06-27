<!-- Header Image Placeholder -->
<div align="center">
  <img src="public/header-image.png" alt="DilMesh Header" width="100%" />
</div>

# DilMesh 🎙️🌐

> **Live Instant Subtitles & Real-time Multi-language Translation**

DilMesh is a powerful desktop application for **real-time speech-to-text and instant multi-language translation**, broadcasting subtitles to multiple windows, fullscreen displays, and **OBS Studio** simultaneously. From a single microphone it can drive **12–16 languages at once**, each placed anywhere on screen — built for conferences, live events, houses of worship, streamers, and accessible multilingual communication.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-2.4.2-brightgreen)](https://github.com/antlionguard/DilMesh/releases)
[![Electron](https://img.shields.io/badge/Electron-30.0.1-blue?logo=electron)](https://www.electronjs.org/)
[![Vue 3](https://img.shields.io/badge/Vue.js-3.4.21-4FC08D?logo=vue.js)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2.2-3178C6?logo=typescript)](https://www.typescriptlang.org/)

---

## ✨ Highlights

- 🎙️ **5 speech-to-text engines** (cloud & fully offline) — switch live, no restart.
- 🌐 **4 translation engines** including **DeepL**, Google Cloud, and offline **NLLB-200** (WASM).
- 🔠 **Many languages on one screen** — 12–16 simultaneous translation layers from a single mic.
- 📺 **OBS Studio output** — every preset is a Browser Source URL; no plugins, no native capture.
- 🧱 **Auto Grid layout + live preview** — drop each language into a cell and see it instantly.
- ⚡ **Sentence-accurate, parallel pipeline** — complete sentences flush the moment they finish (no waiting for the speaker to pause), and all languages translate concurrently so the whole grid fills together.
- 🎚️ **Per-preset enable/disable** — turn off unused scenes so they don't burn translation credits.
- 💾 **Presets, export/import, multi-monitor fullscreen** — production-ready setup management.

---

## 🎙️ Speech-to-Text Providers

Choose from **5 built-in STT providers** — switch between them live from Settings:

| Provider | Type | Description |
|---|---|---|
| **Deepgram** | ☁️ Cloud | Ultra-low latency (Nova-3). Multi-language auto-detect, smart formatting, diarization, filler-word removal, keyword boosting, and per-language parallel streams. |
| **Google Cloud (GCP)** | ☁️ Cloud | Industry-leading accuracy. Interim results, auto-punctuation, enhanced models, confidence threshold, profanity filter. 60 min free/month. |
| **Sherpa-ONNX** | 🗣️ Offline | Fully offline ASR — Omnilingual 1B (1600+ languages), Zipformer, Chinese/English bilingual, Paraformer. |
| **Local Whisper** | 🎧 Offline | OpenAI Whisper locally via HuggingFace Transformers (Tiny → Large v3 Turbo, quantized variants). No internet. |
| **NVIDIA Riva** | ⚡ GPU Server | Self-hosted GPU inference over gRPC for on-premise AI infrastructure. |

## 🌐 Translation Providers

Translate every subtitle layer into its own target language in real time:

| Provider | Type | Description |
|---|---|---|
| **DeepL** | ☁️ Cloud | High-quality translation. Free & Pro/Growth keys auto-detected (`:fx` → free endpoint). Built-in concurrency limiting + automatic 429 retry for heavy multi-language load. |
| **Google Cloud Translation** | ☁️ Cloud | V2 API — 500K characters free/month. |
| **NLLB-200** | 🧠 Offline | Meta's 200-language model running **100% offline** via onnxruntime-web (WASM). Choose **Distilled 600M** or **1.3B**; adjustable beam-search quality. Downloads once, runs locally forever. |
| **Riva NMT** | ⚡ GPU Server | Neural machine translation on a self-hosted Riva server. |
| **Disabled** | 🚫 — | Captions-only display with no translation. |

---

## ⚡ The Subtitle Pipeline

DilMesh is engineered so subtitles appear **fast, sentence-accurate, and all together** — not dribbling in one language at a time.

- **Sentence-accurate flushing** — As soon as a *complete sentence* is finalized (by punctuation), it's pushed to the screen. It does **not** wait for the speaker to pause, so long, continuous speech never piles up into a 5-line block. A configurable **Max Sentences per Subtitle** caps how much shows at once.
- **Works across every STT engine** — Deepgram uses its native `is_final` finalization; cloud/offline engines feed a unified sentence assembler. Same behavior everywhere.
- **Parallel translation** — every language layer is translated **concurrently** (not one after another), so a 12–16 language grid fills in ~one request's time instead of the sum. Ordering is preserved per layer.
- **CPS Queue Player** — translated lines display at a configurable reading speed (default **17 CPS**, the Netflix standard), so audiences can actually read them; the line clears shortly after the queue drains.
- **Graceful by design** — if a translation fails or a provider is rate-limited, the layer falls back to the original text instead of going blank; offline NLLB self-heals if its worker restarts.
- **Voice Activity Detection (Silero VAD)** — runs locally and only forwards speech to the STT provider, cutting API cost and noise. Sensitivity and minimum-silence are adjustable.

```
Microphone ─▶ Silero VAD ─▶ Active STT engine (Deepgram / GCP / Sherpa / Whisper / Riva)
                                      │
                                      ▼
                         Sentence assembler  ──  flush each complete sentence immediately
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                                ▼
        Live layers                              Translation layers (parallel)
     (source text, instant)                  GCP · DeepL · NLLB · Riva NMT
              │                                                │
              └───────────────────────┬───────────────────────┘
                                      ▼
                        Per-layer CPS Queue (reading-speed pacing)
                                      ▼
                Projection windows  +  OBS Browser Sources  (per-layer display)
```

---

## 🔠 Multi-Window Broadcasting & Language Layers

- Open **multiple independent subtitle windows** at once — one per audience group, language, or scene.
- Each window is a **Preset** holding any number of **Language Layers**:
  - **Live Layer** — raw real-time captions in the source language.
  - **Translation Layer** — finalized sentences translated and paced via the CPS queue.
- Per-layer controls: language (30+), font family, size, color, X/Y position (% based), max lines, **max width (px)** for side-by-side layouts, and a text-shadow toggle.
- **Bulk style** — set font/size/color/max-lines once and apply to every layer with one click.

## 🧱 Auto Grid Layout + Live Preview

Designed for fitting **12–16 languages on one wide screen** (e.g. an LED wall):

- **Auto Grid** — set **Columns × Rows**; DilMesh positions every layer and computes each cell's width from your **Output Size**.
- **Per-cell language assignment** — pick which language goes in each grid cell (with swap), so it lines up with a bordered background image.
- **Live in-app preview** — a scaled, real-time mock of the output (correct aspect ratio, fonts, colors, background) with optional grid lines — see the layout before you ever open a window.
- **Output Size (W × H)** — define the exact canvas (e.g. `5120 × 512`) that drives grid widths and the preview; match it to your OBS Browser Source.

## 📺 OBS Studio Output

Bring DilMesh subtitles into OBS with **zero plugins and zero native capture**:

- DilMesh runs a local **HTTP + WebSocket server**; each preset becomes a **Browser Source URL** (`http://localhost:<port>/obs/<presetId>`).
- Click **OBS** on any preset card to copy its URL → add a Browser Source in OBS → done. Real-time captions/translations stream over WebSocket.
- The server **port is configurable** in Settings and falls back to a free port automatically.
- Uses your preset's **chroma-key color** for easy keying, and works **even without opening a projection window** (reads layers/style straight from the saved preset).

## 🎛️ Preset System

- Create, edit, duplicate, and delete **named presets**.
- **Enable/Disable switch** on every card — a disabled preset does **no STT/translation broadcasting**, so unused scenes don't consume API credits/tokens; its window auto-closes.
- **Export / Import presets as JSON** — move a fully-configured 16-language setup to another machine without redoing anything.
- Live-editing: changes push to the open window (and OBS) instantly; everything is persisted on disk and survives restarts.

## 🖥️ Fullscreen Display Targeting

- Auto-detects all connected monitors.
- Assign a preset to a display — opening it **fullscreens on that display** instantly. Windowed mode also supported.

## 🎨 Background & Appearance

- Per-preset **chroma-key color** (for OBS color keying) **or an optional background image** with an opacity slider.
- Vertical alignment and text-shadow controls.

## 🧰 Extras

- **Analog VU Meter** — live audio-level visualization with peak indicators in the dashboard header.
- **Microphone selection** — pick any input device.
- **Profanity filter** (GCP & Deepgram) — masked words are removed before translation.
- **System tray** — minimize while windows and transcription keep running; click to show/hide.

---

## 📦 Supported Languages

- **Recognition (STT):** 50+ languages across providers (English US/UK/AU, Turkish, German, French, Spanish, Italian, Portuguese, Russian, Arabic, Japanese, Korean, Chinese, Hindi, Kazakh, and more). Deepgram offers **Multi (auto-detect)**.
- **Translation (target):** 30+ languages grouped by region (Western/Eastern Europe, Nordic, Baltic, Asia, Middle East, Africa), including Chinese **Simplified / Traditional / Cantonese**.

> Coverage varies by engine — DeepL ~30 languages, NLLB-200 200 languages, GCP/Deepgram very broad. DilMesh falls back to the original text for an unsupported pair rather than going blank.

---

## 🖼️ Screenshots

### 🎛️ Dashboard
_Manage presets, transcription, live preview, and windows from one place._
<div align="center">
  <img src="public/dashboard.png" alt="DilMesh Dashboard" width="800" style="border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" />
</div>

### 🔲 Multi-Window & Fullscreen Projection
_Broadcast subtitles to multiple windows or project them fullscreen on a specific display._
<div align="center">
  <img src="public/windows.png" alt="DilMesh Projection" width="800" style="border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" />
</div>

---

## 🚀 Installation

### Prerequisites
- **Node.js** v18+
- **pnpm**
- An STT/translation API key (Deepgram, Google Cloud, DeepL…) — or use the offline engines with no key.

### Setup
```bash
git clone https://github.com/antlionguard/DilMesh.git
cd DilMesh
pnpm install
pnpm dev
```

### Build
```bash
pnpm build:mac    # macOS (DMG)
pnpm build:win    # Windows (NSIS installer)
pnpm build:all    # both
```

---

## ⚙️ Configuration

### Deepgram (recommended for live)
1. Sign up at [console.deepgram.com](https://console.deepgram.com) (free credit on signup) and create an API key.
2. **Settings → API Integrations → Deepgram** → paste the key.
3. **Settings → Speech-to-Text** → model (Nova-3), language(s), and options.
   - For snappy sentence splitting keep **Punctuate** and **Smart Format** on, **Endpointing** low (~100–300 ms), and **Utterance End** ~1000 ms.

### DeepL
1. Get a key at [deepl.com/pro-api](https://www.deepl.com/pro-api). Free keys end with `:fx`.
2. **Settings → API Integrations → DeepL** → paste the key (the right endpoint is auto-selected).
3. **Settings → Translation** → choose **DeepL**.
   > For 12–16 languages across multiple rooms, an **API Growth/Pro** key (higher monthly characters + rate limits) is recommended over Free (500K chars/month).

### Google Cloud (GCP)
1. Enable **Cloud Speech-to-Text** and **Cloud Translation** in [Google Cloud Console](https://console.cloud.google.com/).
2. Create a Service Account, download the **JSON key**.
3. **Settings → API Integrations → Google Cloud** → paste the JSON.
   > Free tier: STT 60 min/month, Translation V2 500K chars/month.

### NLLB-200 (Offline Translation)
1. **Settings → Translation → NLLB-200**.
2. Pick a model — **Distilled 600M** (~800 MB, faster) or **1.3B** (~1.3 GB, higher quality) — and click **Download** (one time, runs offline after).
3. Tune **Translation Quality (beam search)** for the quality/speed balance you want.

### Local Whisper / Sherpa-ONNX (Offline STT)
- **Settings → Speech-to-Text → Whisper / Sherpa-ONNX** → download a model and select it. No internet required afterward.

### NVIDIA Riva
1. Run a [Riva Server](https://docs.nvidia.com/deeplearning/riva/user-guide/docs/quick-start-guide.html) (server-side NVIDIA GPU).
2. **Settings → API Integrations → NVIDIA Riva** → server URL (e.g. `localhost:50051`) and SSL settings.

### OBS Output
1. (Optional) set the server port in **Settings → Subtitle → OBS Output**.
2. On a preset card click **OBS** to copy its URL.
3. In OBS: **Add → Browser Source** → paste the URL → set width/height to your **Output Size** → add a **Color Key** filter on the chroma background.

---

## 🤝 Contributing

Contributions are welcome — new languages, STT/translation providers, UI improvements, or bug fixes.

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit (`git commit -m 'Add AmazingFeature'`)
4. Push (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.

---

## ❤️ Support

If you find this project useful, you can support its development!

<a href="https://www.buymeacoffee.com/antlionguards" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="50" width="180" />
</a>
