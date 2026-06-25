# FTC Premiere — Yeni Özellikler Implementasyon Planı

3 yeni özellik: Background Image, OBS Output, In-app Preview + Auto Grid.

> [!IMPORTANT]
> Bu değişiklikler production-critical bir etkinlik için. Mevcut preset yapısı ve IPC kanalları bozulmadan, geriye dönük uyumlu şekilde eklenecek.

> [!NOTE]
> **Implementasyon durumu (tamamlandı):** 3 özellik de uygulandı. `vue-tsc` + `vite build` temiz geçiyor.
> - **Sapma:** `obs-overlay.html` ayrı dosya yerine `ObsServer.ts` içine gömülü bir `renderOverlayHtml()` fonksiyonu olarak yazıldı — Electron paketleme sırasında ayrı HTML'in `dist-electron`'a kopyalanma sorununu tamamen ortadan kaldırmak için (tek kaynak).
> - **Ek iyileştirme:** OBS, Electron projection penceresi hiç açılmadan da çalışır — `getConfig` ve canlı yayın hedefleri, bellekte yoksa kalıcı preset'ten (store `project-state`) layer/style okur. Yayın hedefi = açık pencereler ∪ OBS istemcisi olan preset'ler.

---

## Özellik 1: Background Image

Preset'lere chroma key rengi yerine (veya üstüne) arka plan görseli ekleme, opacity slider ile.

### Veri Modeli Değişikliği

`WindowStyle` interface'ine 2 yeni alan:

```typescript
interface WindowStyle {
  backgroundColor: string       // mevcut — chroma key
  textShadow: boolean           // mevcut
  justifyContent: string        // mevcut
  backgroundImage?: string      // YENİ — dosya adı (userData/backgrounds/ altında)
  backgroundOpacity?: number    // YENİ — 0.0-1.0 (default 1.0)
}
```

### Dosya Yönetimi

- Kullanıcı file picker ile görsel seçer → `dialog.showOpenDialog()`
- Seçilen dosya `app.getPath('userData')/backgrounds/{uuid}.{ext}` konumuna kopyalanır
- Preset'te sadece dosya adı saklanır (taşınabilirlik)
- Electron projection: `file://` protocol ile erişim
- OBS overlay: HTTP server üzerinden `/backgrounds/{filename}` ile erişim

---

#### [MODIFY] [main.ts](file:///Users/oguzhan/Desktop/repos/DilMesh/electron/main.ts)

- `LanguageLayer` interface'ine `maxWidth: number` eklenmesi (v2.2.4 eksik kalmış)
- `dialog.showOpenDialog` + dosya kopyalama IPC handler'ı: `select-background-image`
- `get-background-image-path` IPC handler'ı (file:// URL döndürür)
- Backgrounds dizininin oluşturulması (`app.getPath('userData')/backgrounds/`)

#### [MODIFY] [Dashboard.vue](file:///Users/oguzhan/Desktop/repos/DilMesh/src/views/Dashboard.vue)

- **Appearance** bölümüne:
  - "Background Image" file picker butonu (`Select Image` / `Remove`)
  - Seçili görselin thumbnail preview'ı
  - Opacity slider (0% - 100%, default 100%)
- `WindowStyle` interface güncellenmesi

#### [MODIFY] [Projection.vue](file:///Users/oguzhan/Desktop/repos/DilMesh/src/views/Projection.vue)

- Background div'e `background-image` CSS uygulanması
- Opacity için `::after` pseudo-element overlay veya `opacity` CSS property'si
- `settings-updated` event'inde backgroundImage değişikliklerinin yakalanması

---

## Özellik 2: OBS Output (HTTP + WebSocket Server)

OBS Studio'nun **Browser Source** özelliği ile DilMesh altyazılarını capture etme. Yaklaşım:

```
DilMesh Main Process
  ├── HTTP Server (localhost:PORT)
  │     └── /obs/{presetId}  → standalone overlay HTML
  │     └── /backgrounds/{file} → arka plan görselleri
  └── WebSocket Server (ws://localhost:PORT/ws)
        └── transcript-update, settings-updated events
```

**Neden bu yaklaşım?**
- OBS Browser Source herhangi bir URL'i yükleyebilir — native entegrasyon gerektirmez
- Standalone HTML sayfası Vue/Electron bağımlılığı olmadan çalışır
- WebSocket ile gerçek zamanlı veri aktarımı
- Aynı port üzerinden HTTP + WS çalışır

### Kullanım senaryosu:
1. Dashboard'da preset kartında "OBS URL" butonu → URL'i kopyalar
2. OBS'de "Browser Source" ekle → URL yapıştır → `http://localhost:3456/obs/{presetId}`
3. Genişlik/yükseklik ayarla → DilMesh ayarlarıyla aynı çıktı

---

#### [NEW] [ObsServer.ts](file:///Users/oguzhan/Desktop/repos/DilMesh/electron/ObsServer.ts)

Node.js built-in `http` + `ws` paketi ile:

```typescript
class ObsServer {
  private httpServer: http.Server
  private wss: WebSocketServer
  private port: number = 3456

  start()                    // Sunucuyu başlat
  stop()                     // Sunucuyu durdur
  getPort(): number          // Aktif port

  // HTTP Routes:
  // GET /obs/:presetId      → overlay HTML sayfası
  // GET /backgrounds/:file  → arka plan görselleri
  // GET /health             → sunucu durumu

  // WebSocket:
  // Client bağlandığında presetId gönderir
  // Server → client: { type: 'config', layers, style }
  // Server → client: { type: 'transcript', layerId, text, isSentence, seq }

  broadcastTranscript(presetId, data)    // Transcript event'i WS client'lara ilet
  broadcastConfig(presetId, config)      // Config değişikliğini WS client'lara ilet
}
```

#### [DONE — embedded] obs-overlay HTML (ObsServer.ts içindeki `renderOverlayHtml()`)

Standalone HTML overlay (Vue/framework bağımsız), `ObsServer.ts` içine gömülü:

- Vanilla JS + CSS ile Projection.vue'nun render mantığının replikası
- WebSocket bağlantısı → config ve transcript event'leri alır
- CPS kuyruk mantığı (aynı parametreler: cps, min/max display, inactivity clear)
- Layer positioning (positionX/Y, maxWidth, fontSize, fontFamily, textColor)
- Background color/image desteği
- `<body style="background: transparent">` → OBS'de şeffaf arka plan (chroma key yerine)

#### [MODIFY] [main.ts](file:///Users/oguzhan/Desktop/repos/DilMesh/electron/main.ts)

- `ObsServer` import ve başlatma (`app.whenReady()` içinde)
- `broadcastToProjectionWindows` içinde: IPC'ye ek olarak `obsServer.broadcastTranscript()` çağrısı
- `broadcastLiveCaption` içinde: aynı şekilde OBS'ye de ilet
- `update-projection-settings` handler'ında: `obsServer.broadcastConfig()` çağrısı
- `get-obs-url` IPC handler'ı (Dashboard'dan URL alma)

#### [MODIFY] [Dashboard.vue](file:///Users/oguzhan/Desktop/repos/DilMesh/src/views/Dashboard.vue)

- Preset kartına **"OBS"** butonu / badge'i
- Tıklanınca URL'i clipboard'a kopyalar
- Hover'da URL'i gösterir (tooltip)

#### [MODIFY] [vite.config.ts](file:///Users/oguzhan/Desktop/repos/DilMesh/vite.config.ts)

- `ws` paketini external'e ekleme (eğer direct dependency olarak eklenirse)

#### [MODIFY] [package.json](file:///Users/oguzhan/Desktop/repos/DilMesh/package.json)

- `ws` paketini dependencies'e ekleme (transitive olarak var ama explicit olması daha güvenli)

---

## Özellik 3: In-app Preview + Auto Grid Layout

### 3A: In-app Preview

Dashboard editor panelinde, preset'in çıktısının küçültülmüş canlı preview'ı.

```
┌─ Editor Panel ──────────────────────────────┐
│ Edit: My Preset                    [Reload] │
│                                             │
│ ┌─ PREVIEW ───────────────────────────────┐ │
│ │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   │ │
│ │  │ 🇹🇷   │ │ 🇬🇧   │ │ 🇩🇪   │ │ 🇫🇷   │   │ │
│ │  │ TR   │ │ EN   │ │ DE   │ │ FR   │   │ │
│ │  └──────┘ └──────┘ └──────┘ └──────┘   │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ Appearance    │    Display Target            │
│ ...           │    ...                       │
```

**Implementasyon:**
- Pure CSS/Vue — framework bağımsız, iframe/webview yok
- Sabit genişlik konteyner, aspect ratio hedef ekrana göre (varsa display bilgisi, yoksa 16:9)
- Her layer bir `<div>` olarak pozisyonlanır, `transform: scale()` ile küçültülür
- Background color/image gösterilir
- Layer kutuları tıklanabilir → ilgili layer'ın ayarlarını açar
- Gerçek zamanlı güncelleme (v-model ile reactive)

### 3B: Auto Grid Layout

12-16 dili tek bir preset'te konumlandırmak için otomatik grid hesaplama.

**UI:**
```
┌─ Auto Grid Layout ──────────────────────────┐
│  Columns: [___4___]  Rows: [auto]           │
│  Gap: [__10__] px                           │
│  [📐 Apply Grid]  [↩ Reset Positions]       │
└─────────────────────────────────────────────┘
```

**Algoritma:**
```
Columns = kullanıcı girdisi (örn: 12)
Rows = ceil(layerCount / columns)
cellWidth% = 100 / columns
cellHeight% = 100 / rows

For each layer (index i):
  col = i % columns
  row = floor(i / columns)
  positionX = (col + 0.5) * cellWidth     → merkez X (%)
  positionY = (row + 0.5) * cellHeight    → merkez Y (%)
  maxWidth = floor(screenWidth / columns) - gap  (px, ekran bilgisi varsa)
```

**Örnek — 5120x512 ekranda 16 dil, 16 sütun:**
| Dil | Col | positionX | positionY | maxWidth |
|-----|-----|-----------|-----------|----------|
| 1   | 0   | 3.125%    | 50%       | 310px    |
| 2   | 1   | 9.375%    | 50%       | 310px    |
| 3   | 2   | 15.625%   | 50%       | 310px    |
| ... | ... | ...       | ...       | ...      |
| 16  | 15  | 96.875%   | 50%       | 310px    |

---

#### [MODIFY] [Dashboard.vue](file:///Users/oguzhan/Desktop/repos/DilMesh/src/views/Dashboard.vue)

- **Preview Panel**: Editor panelinin üstünde, `Languages` bölümünün üzerinde
  - Scaled container div, background color/image
  - Positioned layer divs with language labels
  - Click-to-select layer interaction
- **Auto Grid Section**: Languages başlığının yanında veya altında
  - Columns input, gap input
  - "Apply Grid" butonu → tüm layer'ların positionX/Y/maxWidth'ini hesaplar
  - Target display seçiliyse ekran çözünürlüğünü kullanır, yoksa 1920 default

---

## Verification Plan

### Automated Tests
```bash
# Build check — TypeScript hatası olmadığından emin ol
npm run build

# Dev mode test
npm run dev
```

### Manuel Doğrulama
1. **Background Image**: Preset'e görsel ekle → projection'da görünsün, opacity değiştir
2. **OBS Output**: `http://localhost:3456/obs/{presetId}` → OBS Browser Source'ta aç, altyazı akışı gelsin
3. **Preview**: Dashboard'da preset seç → layout preview doğru pozisyonları göstersin
4. **Auto Grid**: 12+ dil ekle → "Apply Grid" ile otomatik dağıt → preview'da doğru görünsün
5. **Geriye dönük uyum**: Eski preset'ler (backgroundImage/backgroundOpacity olmadan) çalışmaya devam etsin

---

## Uygulama Sırası

> [!TIP]
> Önerilen sıra, bağımlılıkları minimize eder:

1. **main.ts interface düzeltmesi** (maxWidth ekleme) — küçük, risksiz
2. **Background Image** — bağımsız, küçük scope
3. **In-app Preview + Auto Grid** — Dashboard UI, Background Image ile entegre gösterim
4. **OBS Output** — en büyük scope, yeni dosyalar, ama diğerlerinden bağımsız çalışabilir

## Kararlar (Resolved)

> [!NOTE]
> - **OBS server portu**: Settings'ten ayarlanabilir. Varsayılan 3456. `transcription` (veya yeni `obs`) config section'ında `obsPort` saklanır. Port kullanımdaysa başlatma sırasında bir sonraki boş porta düşülür ve gerçek port Dashboard'a `get-obs-url` ile bildirilir. Settings.vue'ye bir port input'u eklenir; değişince server restart edilir.
> - **OBS overlay arka planı**: Chroma key rengi kullanılır — `obs-overlay.html` body'sine preset'in `style.backgroundColor` değeri uygulanır (örn `#00FF00`). OBS tarafında "Color Key" filtresi ile keylenir. `<body style="background: transparent">` KULLANILMAZ; bunun yerine WS `config` event'i ile gelen backgroundColor body'ye yazılır. (backgroundImage seçiliyse onun üstüne render edilir.)
