import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'

export interface ObsServerConfig {
  style?: any
  layers: any[]
  cps?: number
  queueMaxDepth?: number
  title?: string
}

export interface ObsServerOptions {
  port: number
  backgroundsDir: string
  // Returns the current config for a window/preset so a freshly-connected client can render immediately
  getConfig: (windowId: string) => ObsServerConfig
}

interface ObsClient {
  socket: WebSocket
  presetId: string | null
}

// Preset ids are timestamp-based strings; allow only a strict character class.
// This is the primary defense against reflecting presetId into the overlay's
// script context (XSS), and also bounds what can be subscribed over WebSocket.
const PRESET_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * HTTP + WebSocket server that exposes DilMesh subtitle output as an OBS
 * Browser Source. The overlay HTML is served embedded (single source of truth,
 * no separate file to copy into the packaged build). Real-time transcript and
 * config updates are pushed over WebSocket, keyed by presetId (== windowId).
 */
export class ObsServer {
  private httpServer: http.Server | null = null
  private wss: WebSocketServer | null = null
  private port: number
  private clients = new Set<ObsClient>()
  private readonly backgroundsDir: string
  private readonly getConfig: (windowId: string) => ObsServerConfig

  constructor(opts: ObsServerOptions) {
    this.port = opts.port
    this.backgroundsDir = opts.backgroundsDir
    this.getConfig = opts.getConfig
  }

  getPort(): number {
    return this.port
  }

  /** Distinct preset ids that currently have at least one connected OBS client. */
  getSubscribedPresetIds(): string[] {
    const ids = new Set<string>()
    for (const client of this.clients) {
      if (client.presetId) ids.add(client.presetId)
    }
    return Array.from(ids)
  }

  /** True if any OBS client is subscribed to this preset. */
  hasClientsFor(presetId: string): boolean {
    for (const client of this.clients) {
      if (client.presetId === presetId) return true
    }
    return false
  }

  /**
   * Start the server. If the requested port is busy, try the next ports
   * (up to 20 attempts). Resolves with the actual bound port.
   */
  start(): Promise<number> {
    return this.listenWithFallback(this.port, 20)
  }

  async restart(port: number): Promise<number> {
    await this.stop()
    this.port = port
    return this.start()
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const client of this.clients) {
        try { client.socket.close() } catch { /* ignore */ }
      }
      this.clients.clear()
      const done = () => {
        this.wss = null
        this.httpServer = null
        resolve()
      }
      if (this.wss) {
        this.wss.close(() => {
          if (this.httpServer) this.httpServer.close(() => done())
          else done()
        })
      } else if (this.httpServer) {
        this.httpServer.close(() => done())
      } else {
        done()
      }
    })
  }

  /** Push a transcript payload to all OBS clients subscribed to this preset. */
  broadcastTranscript(presetId: string, payload: any) {
    this.send(presetId, { type: 'transcript', ...payload })
  }

  /** Push a config (style/layers) update to all OBS clients subscribed to this preset. */
  broadcastConfig(presetId: string, config: Partial<ObsServerConfig>) {
    this.send(presetId, { type: 'config', ...config })
  }

  /** Tell connected clients the source window was closed (overlay can show idle state). */
  notifyWindowClosed(presetId: string) {
    this.send(presetId, { type: 'window-closed' })
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private send(presetId: string, message: any) {
    if (!this.wss) return
    const data = JSON.stringify(message)
    for (const client of this.clients) {
      if (client.presetId === presetId && client.socket.readyState === WebSocket.OPEN) {
        try { client.socket.send(data) } catch { /* ignore */ }
      }
    }
  }

  private listenWithFallback(port: number, attemptsLeft: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttp(req, res))

      const onError = (err: NodeJS.ErrnoException) => {
        server.removeListener('error', onError)
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          console.warn(`[ObsServer] Port ${port} in use, trying ${port + 1}`)
          this.listenWithFallback(port + 1, attemptsLeft - 1).then(resolve).catch(reject)
        } else {
          reject(err)
        }
      }

      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError)
        this.httpServer = server
        this.port = port
        this.setupWebSocket(server)
        resolve(port)
      })
    })
  }

  // Allow only the OBS overlay page itself (served from our own origin) or
  // non-browser clients that send no Origin. This blocks Cross-Site WebSocket
  // Hijacking: a malicious web page open in the user's browser cannot connect
  // and read live transcripts, because browsers always send a cross-origin Origin.
  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true // native client (no browser Origin header)
    try {
      const u = new URL(origin)
      const host = u.hostname
      const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
      return (host === 'localhost' || host === '127.0.0.1') && port === this.port
    } catch {
      return false
    }
  }

  private setupWebSocket(server: http.Server) {
    const wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: (info, cb) => {
        if (this.isAllowedOrigin(info.origin)) cb(true)
        else cb(false, 403, 'Forbidden origin')
      }
    })
    this.wss = wss

    wss.on('connection', (socket: WebSocket) => {
      const client: ObsClient = { socket, presetId: null }
      this.clients.add(client)

      socket.on('message', (raw) => {
        let msg: any
        try { msg = JSON.parse(raw.toString()) } catch { return }
        if (msg && msg.type === 'subscribe' && typeof msg.presetId === 'string' && PRESET_ID_RE.test(msg.presetId)) {
          client.presetId = msg.presetId
          // Send the current config immediately so the overlay can render
          try {
            const cfg = this.getConfig(msg.presetId)
            socket.send(JSON.stringify({ type: 'config', ...cfg }))
          } catch (e) {
            console.error('[ObsServer] getConfig failed:', e)
          }
        }
      })

      socket.on('close', () => this.clients.delete(client))
      socket.on('error', () => this.clients.delete(client))
    })
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`)
    const pathname = decodeURIComponent(url.pathname)

    // No permissive CORS: the overlay page is loaded top-level by OBS and its
    // WebSocket is same-origin, so cross-origin reads of transcripts/backgrounds
    // are not needed and would only widen the attack surface.

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, port: this.port, clients: this.clients.size }))
      return
    }

    if (pathname.startsWith('/obs/')) {
      const presetId = pathname.slice('/obs/'.length).replace(/\/$/, '')
      if (!PRESET_ID_RE.test(presetId)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid preset id')
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(renderOverlayHtml(presetId, this.port))
      return
    }

    if (pathname.startsWith('/backgrounds/')) {
      this.serveBackground(pathname.slice('/backgrounds/'.length), res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }

  private serveBackground(filename: string, res: http.ServerResponse) {
    // Prevent path traversal — only allow a bare filename
    const safe = path.basename(filename)
    const full = path.join(this.backgroundsDir, safe)
    if (!full.startsWith(this.backgroundsDir) || !fs.existsSync(full)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }
    const ext = path.extname(safe).toLowerCase()
    const mime: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
    }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' })
    fs.createReadStream(full).pipe(res)
  }
}

/**
 * Standalone overlay HTML — a framework-free replica of Projection.vue's render
 * logic (layer positioning + per-layer CPS queue). Connects back over WebSocket,
 * subscribes to `presetId`, and renders config + transcript events.
 */
function renderOverlayHtml(presetId: string, wsPort: number): string {
  // presetId is already validated against PRESET_ID_RE before this is called,
  // so it is safe to embed in the script context.
  const safePreset = JSON.stringify(presetId)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>DilMesh OBS Overlay</title>
<style>
  html, body {
    margin: 0; padding: 0; width: 100vw; height: 100vh;
    overflow: hidden; background: #00FF00;
  }
  #bg {
    position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: -10;
    background-size: cover; background-position: center; background-repeat: no-repeat;
  }
  .layer {
    position: fixed; box-sizing: border-box; z-index: 1000;
    transform: translate(-50%, -50%);
    transition: all 0.3s ease;
  }
  .layer-text {
    text-align: center; line-height: 1.2;
    display: flex; flex-direction: column; justify-content: flex-end;
    overflow: hidden; overflow-wrap: break-word; word-break: break-word;
    white-space: pre-wrap; transition: all 0.3s ease;
  }
</style>
</head>
<body>
<div id="bg"></div>
<div id="layers"></div>
<script>
(function () {
  var PRESET_ID = ${safePreset};
  var WS_PORT = ${wsPort};

  // ── State ──────────────────────────────────────────────────────────────
  var cps = 17;
  var queueMaxDepth = 0;
  var MIN_DISPLAY_MS = 1500;
  var MAX_DISPLAY_MS = 7000;
  var INACTIVITY_CLEAR_MS = 10000;

  var sharedStyle = { backgroundColor: '#00FF00', textShadow: true, justifyContent: 'center' };
  var layers = [];
  var layerEls = {};   // layerId -> { wrap, text }
  var queues = {};     // layerId -> queue state

  var bgEl = document.getElementById('bg');
  var layersEl = document.getElementById('layers');

  function getQueue(layerId, isTranslation) {
    if (!queues[layerId]) {
      queues[layerId] = {
        sentenceQueue: [], displayTimer: null, inactivityTimer: null,
        isDisplaying: false, isTranslationMode: isTranslation
      };
    }
    return queues[layerId];
  }

  function calcHoldMs(text) {
    return Math.min(Math.max((text.length / cps) * 1000, MIN_DISPLAY_MS), MAX_DISPLAY_MS);
  }

  function setText(layerId, txt) {
    var el = layerEls[layerId];
    if (el) el.text.textContent = txt;
  }

  function resetInactivityTimer(layerId) {
    var q = queues[layerId];
    if (!q) return;
    if (q.inactivityTimer) clearTimeout(q.inactivityTimer);
    q.inactivityTimer = setTimeout(function () {
      setText(layerId, '');
      q.isDisplaying = false;
    }, INACTIVITY_CLEAR_MS);
  }

  function showNextFromQueue(layerId) {
    var q = queues[layerId];
    if (!q) return;
    if (q.sentenceQueue.length === 0) {
      q.isDisplaying = false;
      resetInactivityTimer(layerId);
      return;
    }
    var entry = q.sentenceQueue.shift();
    setText(layerId, entry.text);
    var holdMs = calcHoldMs(entry.text);
    q.displayTimer = setTimeout(function () { showNextFromQueue(layerId); }, holdMs);
  }

  function insertOrdered(queue, text, seq) {
    var entry = { text: text, seq: seq };
    if (queue.length === 0 || seq > queue[queue.length - 1].seq) {
      queue.push(entry);
    } else {
      var lo = 0, hi = queue.length;
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        if (queue[mid].seq < seq) lo = mid + 1; else hi = mid;
      }
      queue.splice(lo, 0, entry);
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  function applyBackground() {
    bgEl.style.backgroundColor = sharedStyle.backgroundColor || '#00FF00';
    document.body.style.background = sharedStyle.backgroundColor || '#00FF00';
    if (sharedStyle.backgroundImage) {
      bgEl.style.backgroundImage = "url('/backgrounds/" + sharedStyle.backgroundImage + "')";
      bgEl.style.opacity = (typeof sharedStyle.backgroundOpacity === 'number')
        ? String(sharedStyle.backgroundOpacity) : '1';
    } else {
      bgEl.style.backgroundImage = 'none';
      bgEl.style.opacity = '1';
    }
  }

  function layerPositionStyle(layer, wrap) {
    wrap.style.left = layer.positionX + '%';
    wrap.style.top = layer.positionY + '%';
    var hasMax = layer.maxWidth > 0;
    wrap.style.width = hasMax ? (layer.maxWidth + 'px') : '100vw';
    wrap.style.maxWidth = hasMax ? (layer.maxWidth + 'px') : '100vw';
    wrap.style.padding = hasMax ? '0 8px' : '0 2vw';
  }

  function layerTextStyle(layer, text) {
    text.style.color = layer.textColor;
    text.style.fontSize = layer.fontSize + 'px';
    text.style.fontFamily = layer.fontFamily;
    text.style.textShadow = sharedStyle.textShadow ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none';
    text.style.maxHeight = layer.maxLines > 0 ? (layer.fontSize * 1.2 * layer.maxLines + 'px') : 'unset';
  }

  function rebuildLayers() {
    // Clear timers
    for (var id in queues) {
      if (queues[id].displayTimer) clearTimeout(queues[id].displayTimer);
      if (queues[id].inactivityTimer) clearTimeout(queues[id].inactivityTimer);
    }
    queues = {};
    layerEls = {};
    layersEl.innerHTML = '';

    layers.forEach(function (layer) {
      var wrap = document.createElement('div');
      wrap.className = 'layer';
      var text = document.createElement('div');
      text.className = 'layer-text';
      layerPositionStyle(layer, wrap);
      layerTextStyle(layer, text);
      wrap.appendChild(text);
      layersEl.appendChild(wrap);
      layerEls[layer.id] = { wrap: wrap, text: text };

      var isTranslation = layer.language !== 'live';
      getQueue(layer.id, isTranslation);
      text.textContent = isTranslation ? '' : 'Waiting for subtitles...';
    });
  }

  // ── Transcript handling (mirrors Projection.vue) ─────────────────────────
  function handleTranscript(result) {
    var layerId = result.layerId;
    if (!layerId) return;
    var q = queues[layerId];
    if (!q) return;

    if (!q.isTranslationMode) {
      if (!result.isSentence) {
        setText(layerId, result.text);
        resetInactivityTimer(layerId);
      }
      return;
    }

    // Translation mode
    if (!result.isSentence) return;
    if (q.inactivityTimer) { clearTimeout(q.inactivityTimer); q.inactivityTimer = null; }
    if (queueMaxDepth > 0 && q.sentenceQueue.length >= queueMaxDepth) q.sentenceQueue.shift();
    insertOrdered(q.sentenceQueue, result.text, (result.seq != null) ? result.seq : Date.now());
    if (!q.isDisplaying) {
      q.isDisplaying = true;
      showNextFromQueue(layerId);
    }
  }

  function handleConfig(cfg) {
    if (cfg.style) sharedStyle = cfg.style;
    if (typeof cfg.cps === 'number') cps = cfg.cps;
    if (typeof cfg.queueMaxDepth === 'number') queueMaxDepth = cfg.queueMaxDepth;
    applyBackground();
    if (cfg.layers) {
      layers = cfg.layers;
      rebuildLayers();
    }
  }

  // ── WebSocket ────────────────────────────────────────────────────────────
  var ws = null;
  var reconnectTimer = null;

  function connect() {
    ws = new WebSocket('ws://localhost:' + WS_PORT + '/ws');

    ws.onopen = function () {
      ws.send(JSON.stringify({ type: 'subscribe', presetId: PRESET_ID }));
    };

    ws.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.type === 'config') handleConfig(msg);
      else if (msg.type === 'transcript') handleTranscript(msg);
    };

    ws.onclose = function () {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1500);
    };

    ws.onerror = function () {
      try { ws.close(); } catch (e) {}
    };
  }

  applyBackground();
  connect();
})();
</script>
</body>
</html>`
}
