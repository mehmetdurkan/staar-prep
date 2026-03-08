/**
 * Whiteboard Scratchpad — Lone Star STAAR Prep
 * Self-contained module. Injects its own HTML.
 * Usage: window.Whiteboard.open() / .close() / .clear()
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let isOpen      = false;
  let tool        = 'pencil'; // 'pencil' | 'eraser'
  let color       = '#1A1A2E';
  let gridOn      = false;
  let numpadOn    = false;
  let drawing     = false;
  let lastX       = 0;
  let lastY       = 0;
  let points      = [];       // current stroke points for smoothing

  // Text cursor (numpad mode)
  let textCursor  = null;     // {x, y}
  let textBuffer  = '';
  let blinkTimer  = null;
  let blinkVisible = true;

  // Canvas refs
  let displayCanvas, displayCtx;
  let offCanvas,     offCtx;    // permanent drawings live here
  let sheet;                    // the bottom sheet element

  const COLORS = ['#1A1A2E', '#BF0A30', '#002868', '#2E7D32'];
  const COLOR_LABELS = ['Black', 'Red', 'Blue', 'Green'];

  // ── Inject HTML ────────────────────────────────────────────────────────────
  function inject() {
    if (document.getElementById('wb-sheet')) return;

    const el = document.createElement('div');
    el.id = 'wb-sheet';
    el.innerHTML = `
      <div class="wb-handle-bar"><div class="wb-handle-pill"></div></div>
      <div class="wb-header">
        <span class="wb-title">✏️ Scratch Work</span>
        <div class="wb-header-actions">
          <button class="wb-btn wb-clear-btn" onclick="Whiteboard.clear()" title="Clear">🗑 Clear</button>
          <button class="wb-btn wb-close-btn" onclick="Whiteboard.close()" title="Close">✕</button>
        </div>
      </div>
      <div class="wb-toolbar">
        <div class="wb-tool-group">
          <button class="wb-tool wb-tool-active" id="wbPencilBtn" onclick="WB._setTool('pencil')" title="Pencil">🖊️</button>
          <button class="wb-tool" id="wbEraserBtn" onclick="WB._setTool('eraser')" title="Eraser">⬜</button>
        </div>
        <div class="wb-tool-group wb-colors">
          ${COLORS.map((c, i) => `
            <button class="wb-color-swatch ${i === 0 ? 'wb-color-active' : ''}"
              style="background:${c}"
              onclick="WB._setColor('${c}', this)"
              title="${COLOR_LABELS[i]}"></button>
          `).join('')}
        </div>
        <div class="wb-tool-group">
          <button class="wb-tool" id="wbRulerBtn" onclick="WB._toggleGrid()" title="Grid/Ruler">📏</button>
          <button class="wb-tool" id="wbNumpadBtn" onclick="WB._toggleNumpad()" title="Number Pad">🔢</button>
        </div>
      </div>
      <div class="wb-canvas-wrap" id="wbCanvasWrap">
        <canvas id="wbCanvas"></canvas>
      </div>
      <div class="wb-numpad" id="wbNumpad" style="display:none">
        ${[
          ['7','8','9','+'],
          ['4','5','6','−'],
          ['1','2','3','×'],
          ['.','0','⌫','='],
        ].map(row =>
          `<div class="wb-numpad-row">${row.map(k =>
            `<button class="wb-numpad-key ${k==='⌫'?'wb-numpad-del':''}" onclick="WB._numkey('${k}')">${k}</button>`
          ).join('')}</div>`
        ).join('')}
      </div>
    `;
    document.body.appendChild(el);
    sheet = el;

    // Wire canvas
    displayCanvas = document.getElementById('wbCanvas');
    displayCtx    = displayCanvas.getContext('2d');
    offCanvas     = document.createElement('canvas');
    offCtx        = offCanvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Draw events — touch
    displayCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
    displayCanvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    displayCanvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
    // Draw events — mouse
    displayCanvas.addEventListener('mousedown',  onMouseDown);
    displayCanvas.addEventListener('mousemove',  onMouseMove);
    displayCanvas.addEventListener('mouseup',    onMouseUp);
    displayCanvas.addEventListener('mouseleave', onMouseUp);

    // Swipe down to close
    let touchStartY = 0;
    el.querySelector('.wb-handle-bar').addEventListener('touchstart', e => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    el.querySelector('.wb-handle-bar').addEventListener('touchmove', e => {
      if (e.touches[0].clientY - touchStartY > 60) Whiteboard.close();
    }, { passive: true });
  }

  // ── Canvas resize ──────────────────────────────────────────────────────────
  function resizeCanvas() {
    if (!displayCanvas) return;
    const wrap = document.getElementById('wbCanvasWrap');
    const w    = wrap.offsetWidth;
    const h    = wrap.offsetHeight;
    if (w === 0 || h === 0) return;

    // Save existing drawings
    const tmp = document.createElement('canvas');
    tmp.width  = offCanvas.width  || w;
    tmp.height = offCanvas.height || h;
    tmp.getContext('2d').drawImage(offCanvas, 0, 0);

    displayCanvas.width = w;
    displayCanvas.height = h;
    offCanvas.width     = w;
    offCanvas.height    = h;

    // Restore
    offCtx.drawImage(tmp, 0, 0, w, h);
    composite();
  }

  // ── Composite (render display canvas) ─────────────────────────────────────
  function composite() {
    if (!displayCtx) return;
    const w = displayCanvas.width;
    const h = displayCanvas.height;

    displayCtx.clearRect(0, 0, w, h);

    // White background
    displayCtx.fillStyle = '#FFFFFF';
    displayCtx.fillRect(0, 0, w, h);

    // Grid
    if (gridOn) drawGrid(w, h);

    // Permanent drawings
    displayCtx.drawImage(offCanvas, 0, 0);

    // Pending text at cursor
    if (numpadOn && textCursor) {
      displayCtx.font      = 'bold 24px monospace';
      displayCtx.fillStyle = color;
      displayCtx.fillText(textBuffer, textCursor.x, textCursor.y);

      if (blinkVisible) {
        const tw = displayCtx.measureText(textBuffer).width;
        displayCtx.fillStyle   = color;
        displayCtx.fillRect(textCursor.x + tw + 2, textCursor.y - 20, 2, 24);
      }

      // Cursor crosshair dot
      displayCtx.beginPath();
      displayCtx.arc(textCursor.x, textCursor.y, 3, 0, Math.PI * 2);
      displayCtx.fillStyle = color;
      displayCtx.fill();
    }
  }

  function drawGrid(w, h) {
    const step = 30;
    displayCtx.strokeStyle = 'rgba(0,40,104,0.10)';
    displayCtx.lineWidth   = 1;
    for (let x = 0; x <= w; x += step) {
      displayCtx.beginPath();
      displayCtx.moveTo(x, 0);
      displayCtx.lineTo(x, h);
      displayCtx.stroke();
    }
    for (let y = 0; y <= h; y += step) {
      displayCtx.beginPath();
      displayCtx.moveTo(0, y);
      displayCtx.lineTo(w, y);
      displayCtx.stroke();
    }
  }

  // ── Pointer helpers ────────────────────────────────────────────────────────
  function getPos(e, isTouch) {
    const rect = displayCanvas.getBoundingClientRect();
    const src  = isTouch ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (displayCanvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (displayCanvas.height / rect.height),
    };
  }

  // ── Drawing ────────────────────────────────────────────────────────────────
  function beginStroke(x, y) {
    // In numpad mode: place or commit text cursor
    if (numpadOn) {
      if (textCursor && textBuffer.length > 0) commitText();
      textCursor  = { x, y };
      textBuffer  = '';
      composite();
      return;
    }
    drawing = true;
    points  = [{ x, y }];
    lastX   = x;
    lastY   = y;

    offCtx.beginPath();
    offCtx.moveTo(x, y);
    setupStrokeStyle(offCtx);
  }

  function continueStroke(x, y) {
    if (!drawing || numpadOn) return;
    points.push({ x, y });

    // Smooth with quadratic curve using midpoints
    if (points.length >= 3) {
      const p0 = points[points.length - 3];
      const p1 = points[points.length - 2];
      const p2 = points[points.length - 1];
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      offCtx.quadraticCurveTo(p1.x, p1.y, midX, midY);
      offCtx.stroke();
      offCtx.beginPath();
      offCtx.moveTo(midX, midY);
      setupStrokeStyle(offCtx);
    }

    composite();
    lastX = x;
    lastY = y;
  }

  function endStroke() {
    if (!drawing) return;
    drawing = false;
    offCtx.closePath();
    composite();
  }

  function setupStrokeStyle(ctx) {
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth   = 22;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineWidth   = 3;
    }
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';
  }

  // ── Touch handlers ─────────────────────────────────────────────────────────
  function onTouchStart(e) {
    e.preventDefault();
    const { x, y } = getPos(e, true);
    beginStroke(x, y);
  }
  function onTouchMove(e) {
    e.preventDefault();
    const { x, y } = getPos(e, true);
    continueStroke(x, y);
  }
  function onTouchEnd(e) {
    e.preventDefault();
    endStroke();
  }

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  function onMouseDown(e) {
    const { x, y } = getPos(e, false);
    beginStroke(x, y);
  }
  function onMouseMove(e) {
    const { x, y } = getPos(e, false);
    continueStroke(x, y);
  }
  function onMouseUp() { endStroke(); }

  // ── Text cursor (numpad) ───────────────────────────────────────────────────
  function commitText() {
    if (!textCursor || textBuffer.length === 0) return;
    offCtx.font      = 'bold 24px monospace';
    offCtx.fillStyle = color;
    offCtx.globalCompositeOperation = 'source-over';
    offCtx.fillText(textBuffer, textCursor.x, textCursor.y);
    textBuffer = '';
    textCursor = null;
  }

  function startBlink() {
    stopBlink();
    blinkVisible = true;
    blinkTimer = setInterval(() => {
      blinkVisible = !blinkVisible;
      composite();
    }, 530);
  }

  function stopBlink() {
    if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
    blinkVisible = true;
  }

  // ── Public tool API (called from HTML onclick) ─────────────────────────────
  const WB = {
    _setTool(t) {
      tool = t;
      document.getElementById('wbPencilBtn').classList.toggle('wb-tool-active', t === 'pencil');
      document.getElementById('wbEraserBtn').classList.toggle('wb-tool-active', t === 'eraser');
    },

    _setColor(c, btn) {
      color = c;
      document.querySelectorAll('.wb-color-swatch').forEach(s => s.classList.remove('wb-color-active'));
      btn.classList.add('wb-color-active');
      if (tool === 'eraser') WB._setTool('pencil');
    },

    _toggleGrid() {
      gridOn = !gridOn;
      document.getElementById('wbRulerBtn').classList.toggle('wb-tool-active', gridOn);
      composite();
    },

    _toggleNumpad() {
      numpadOn = !numpadOn;
      document.getElementById('wbNumpadBtn').classList.toggle('wb-tool-active', numpadOn);
      document.getElementById('wbNumpad').style.display = numpadOn ? 'grid' : 'none';

      const wrap = document.getElementById('wbCanvasWrap');
      wrap.style.flex = numpadOn ? '0 0 auto' : '1';
      wrap.style.height = numpadOn ? '160px' : '';

      if (numpadOn) {
        setTimeout(() => { resizeCanvas(); startBlink(); }, 50);
      } else {
        commitText();
        stopBlink();
        textCursor = null;
        textBuffer = '';
        setTimeout(resizeCanvas, 50);
      }
    },

    _numkey(k) {
      if (!textCursor) {
        // Default cursor to center of canvas
        textCursor = {
          x: displayCanvas.width  / 2 - 30,
          y: displayCanvas.height / 2,
        };
      }
      if (k === '⌫') {
        textBuffer = textBuffer.slice(0, -1);
      } else {
        // Map display symbols to real chars
        const map = { '−': '−', '×': '×', '=': '=' };
        textBuffer += map[k] || k;
      }
      composite();
    },
  };

  // Expose WB globally for inline onclick handlers
  window.WB = WB;

  // ── Public API ─────────────────────────────────────────────────────────────
  const Whiteboard = {
    open() {
      inject();
      if (isOpen) return;
      isOpen = true;
      sheet.classList.add('wb-open');
      // Size canvas after sheet is visible
      setTimeout(resizeCanvas, 50);
    },

    close() {
      if (!sheet) return;
      isOpen = false;
      sheet.classList.remove('wb-open');
      stopBlink();
    },

    clear() {
      if (!offCtx) return;
      offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
      textCursor = null;
      textBuffer = '';
      composite();
    },

    // Called on page load — sets up FAB wiring
    init() {
      inject();
      const fab = document.getElementById('wbFab');
      if (fab) {
        fab.addEventListener('click', () => {
          isOpen ? Whiteboard.close() : Whiteboard.open();
        });
      }
    },
  };

  window.Whiteboard = Whiteboard;

  // Auto-init once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Whiteboard.init);
  } else {
    Whiteboard.init();
  }
})();
