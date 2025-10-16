/* ============================================================
   Mojave Refinery — Zone 1 (Disassembly Bay)
   JavaScript (drop in as zone1.js)

   WHAT THIS FILE DOES (MVP):
   - Loads your base image (“ZONE 1.jpg”) and the color mask (“ZONE 1 (Maps).jpg”)
   - Builds a simple camera + 2D world drawn to #world canvas
   - Creates a walkable area from the BLUE in the mask
   - Auto-detects RED islands as interactive HOTSPOTS
   - Spawns the player at the WHITE dot (or first blue pixel fallback)
   - Lets you move with WASD (clamped to walkable)
   - When close to a hotspot: press E to start either Cutting or Bolting mini-game
   - On success: increments Salvage & Crates, hides that hotspot
   - Simple HUD updates + basic overlays management

   NOTES:
   - JPG color compression can slightly shift RGB values; we use tolerant color matching.
   - Keep “ZONE 1.jpg” and “ZONE 1 (Maps).jpg” in the same folder as your HTML.
   - No external libraries. Vanilla JS for clarity.

   You can adjust constants in CONFIG below to tweak feel.
   ============================================================ */

(() => {
  /* ---------------------------- CONFIG ---------------------------- */
  const CONFIG = {
    images: {
      base: 'ZONE 1.jpg',
      mask: 'ZONE 1 (Maps).jpg',
      // optional sprite: 'worker-sprite.png'
    },
    // Movement
    speed: 220,             // pixels / second (world space)
    sprintMult: 1.6,
    avatarRadius: 12,       // for proximity checks
    // Camera
    camLerp: 0.08,          // how fast camera follows the player
    // Color tolerance (for mask classification)
    colorTol: 48,
    // Hotspots
    hotspotMinArea: 120,    // min pixel count to treat as an island
    hotspotProximity: 72,   // distance to allow interaction
    maxHotspots: 18,        // safety cap
    // Minigames
    cut: {
      pathSegments: 8,      // spline complexity
      tolerance: 18,        // px distance to count as “on path”
      minCoverage: 0.55     // % of checkpoints that must be hit to enable Confirm
    },
    bolt: {
      keys: ['A','S','D','F','Q','E','W'],
      minLen: 7,
      maxLen: 12,
      perKeyWindowMs: 900   // time window per key
    },
    // Visual
    pipEnabled: true,
  };

  /* ----------------------------- DOM ----------------------------- */
  const els = {
    world: document.getElementById('world'),
    fx: document.getElementById('fx'),
    imgBase: document.getElementById('img-base'),
    imgMask: document.getElementById('img-mask'),
    hudMsg: document.getElementById('hud-msg'),
    hudSalvage: document.getElementById('hud-salvage'),
    hudQuality: document.getElementById('hud-quality'),
    hudCrates: document.getElementById('hud-crates'),
    viewport: document.getElementById('viewport'),
    dockTask: document.getElementById('task'),
    // overlays
    ovHelp: document.getElementById('overlay-help'),
    ovCut: document.getElementById('overlay-cut'),
    ovBolt: document.getElementById('overlay-bolt'),
    ovResults: document.getElementById('overlay-results'),
    cutCanvas: document.getElementById('cut-canvas'),
    cutConfirm: document.getElementById('cut-confirm'),
    cutCancel: document.getElementById('cut-cancel'),
    boltSeq: document.getElementById('bolt-seq'),
    boltProgress: document.getElementById('bolt-progress').querySelector('span'),
    boltConfirm: document.getElementById('bolt-confirm'),
    boltCancel: document.getElementById('bolt-cancel'),
    resultsList: document.getElementById('results-list'),
    resultsClose: document.getElementById('results-close'),
    btnHelp: document.getElementById('btn-help'),
    btnReset: document.getElementById('btn-reset'),
    btnContinue: document.getElementById('btn-continue'),
  };

  // Create avatar element (styled by CSS you pasted)
  const avatarEl = document.createElement('div');
  avatarEl.id = 'avatar';
  els.viewport.appendChild(avatarEl);

  // Container for hotspot pips (absolutely positioned children)
  const pipsLayer = document.createElement('div');
  pipsLayer.style.position = 'absolute';
  pipsLayer.style.inset = '0';
  pipsLayer.style.pointerEvents = 'none';
  els.viewport.appendChild(pipsLayer);

  // Optional toasts container
  const toasts = document.createElement('div');
  toasts.id = 'toasts';
  els.viewport.appendChild(toasts);

  /* ----------------------------- STATE ---------------------------- */
  const state = {
    loaded: false,
    baseW: 0, baseH: 0,       // base image size (world size)
    // camera
    cam: { x: 0, y: 0, scale: 1 },
    // player
    player: { x: 0, y: 0, vx: 0, vy: 0, sprint: false, moving: false },
    // inputs
    keys: {},
    // mask canvas for pixel sampling
    maskCanvas: document.createElement('canvas'),
    maskCtx: null,
    // nav / islands
    hotspots: [],             // {id, cx, cy, area, type, completed, pipEl}
    logistics: [],            // array of dropoff points (yellow islands)
    // game stats
    salvage: 0,
    crates: 0,
    quality: 100,
    activeHotspot: null,
    lastTS: 0,
    // minigames
    mgCut: { checkpoints: [], hits: 0, total: 0 },
    mgBolt: { seq: [], idx: 0, timer: null, successCount: 0, total: 0, running: false },
  };

  /* ----------------------- IMAGE LOADING ------------------------- */
  function loadImages() {
    const promises = [els.imgBase, els.imgMask].map(img => {
      return new Promise(res => {
        if (img.complete && img.naturalWidth) return res();
        img.onload = () => res();
        img.onerror = () => res(); // fail-safe
      });
    });
    Promise.all(promises).then(initAfterImages);
  }

  /* --------------------------- INIT ------------------------------ */
  function initAfterImages() {
    // Base world size from base image
    state.baseW = els.imgBase.naturalWidth || 1920;
    state.baseH = els.imgBase.naturalHeight || 1080;

    // Prepare canvases to match viewport pixel ratio
    resizeCanvases();

    // Prepare mask sampling
    state.maskCanvas.width = state.baseW;
    state.maskCanvas.height = state.baseH;
    state.maskCtx = state.maskCanvas.getContext('2d', { willReadFrequently: true });
    state.maskCtx.drawImage(els.imgMask, 0, 0, state.baseW, state.baseH);

    // Build islands: RED = hotspots, YELLOW = logistics
    buildIslands();

    // Spawn point: WHITE pixel (or fallback to first blue)
    const spawn = getSpawnPoint();
    state.player.x = spawn.x;
    state.player.y = spawn.y;

    // Camera start centered on player
    centerCameraInstant();

    // Events
    bindInputs();
    bindOverlayButtons();

    // Start loop
    state.loaded = true;
    state.lastTS = performance.now();
    requestAnimationFrame(loop);

    toast('Loaded Zone 1. Walk to a glowing pip and press E.', 'ok');
    updateHUD();
  }

  function resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;
    const rect = els.viewport.getBoundingClientRect();
    [els.world, els.fx].forEach(c => {
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      c.style.width = '100%';
      c.style.height = '100%';
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
    });
  }

  window.addEventListener('resize', () => {
    if (!state.loaded) return;
    resizeCanvases();
  });

  /* ---------------------- MASK CLASSIFIERS ----------------------- */
  function isApproxColor(r, g, b, target, tol = CONFIG.colorTol) {
    return Math.abs(r - target[0]) <= tol &&
           Math.abs(g - target[1]) <= tol &&
           Math.abs(b - target[2]) <= tol;
  }
  function classifyPixel(r, g, b) {
    // BLUE walkable, RED hotspot, YELLOW logistics, WHITE spawn
    if (isApproxColor(r,g,b, [0,0,255])) return 'blue';
    if (isApproxColor(r,g,b, [255,0,0])) return 'red';
    if (isApproxColor(r,g,b, [255,255,0])) return 'yellow';
    if (isApproxColor(r,g,b, [255,255,255], 30)) return 'white';
    return 'other';
  }

  /* ------------------------ ISLAND BUILDING ---------------------- */
  function buildIslands() {
    const w = state.baseW, h = state.baseH;
    const ctx = state.maskCtx;
    const img = ctx.getImageData(0,0,w,h);
    const data = img.data;
    const seen = new Uint8Array(w*h);

    const getIdx = (x,y) => (y*w + x);
    const getRGB = (x,y) => {
      const i = getIdx(x,y)*4;
      return [data[i], data[i+1], data[i+2]];
    };

    let hotspotCount = 0;

    for (let y=0; y<h; y+=2) { // stride 2 for speed
      for (let x=0; x<w; x+=2) {
        const idx = getIdx(x,y);
        if (seen[idx]) continue;
        const [r,g,b] = getRGB(x,y);
        const cls = classifyPixel(r,g,b);
        if (cls !== 'red' && cls !== 'yellow') { seen[idx]=1; continue; }

        // Flood fill this island
        const q = [[x,y]];
        seen[idx]=1;
        let area=0, sumx=0, sumy=0, minx=x, miny=y, maxx=x, maxy=y;

        while (q.length) {
          const [cx, cy] = q.pop();
          area++;
          sumx += cx; sumy += cy;
          if (cx<minx) minx=cx; if (cy<miny) miny=cy;
          if (cx>maxx) maxx=cx; if (cy>maxy) maxy=cy;

          // neighbors (4-connected)
          const nbrs = [[1,0],[-1,0],[0,1],[0,-1]];
          for (const [dx,dy] of nbrs) {
            const nx = cx + dx, ny = cy + dy;
            if (nx<0||ny<0||nx>=w||ny>=h) continue;
            const nidx = getIdx(nx,ny);
            if (seen[nidx]) continue;
            const [rr,gg,bb] = getRGB(nx,ny);
            if (classifyPixel(rr,gg,bb) === cls) {
              seen[nidx]=1;
              q.push([nx,ny]);
            } else {
              seen[nidx]=1; // mark anyway to avoid reprocessing small edges
            }
          }
        }

        if (cls === 'red' && area >= CONFIG.hotspotMinArea && hotspotCount < CONFIG.maxHotspots) {
          const cx = sumx/area, cy = sumy/area;
          const type = (hotspotCount % 2 === 0) ? 'cut' : 'bolt'; // alternate types
          const spot = {
            id: `hs_${hotspotCount}`,
            cx, cy, area, type, completed: false, pipEl: null
          };
          state.hotspots.push(spot);
          hotspotCount++;
        }

        if (cls === 'yellow' && area >= 60) {
          state.logistics.push({ cx: sumx/area, cy: sumy/area, area });
        }
      }
    }

    // Create pips
    if (CONFIG.pipEnabled) {
      for (const hs of state.hotspots) {
        const pip = document.createElement('div');
        pip.className = 'hotspot-pip';
        pipsLayer.appendChild(pip);
        hs.pipEl = pip;
      }
    }
  }

  function getSpawnPoint() {
    const w = state.baseW, h = state.baseH;
    const ctx = state.maskCtx;
    const data = ctx.getImageData(0,0,w,h).data;
    // find white dot
    for (let y=0; y<h; y+=2) {
      for (let x=0; x<w; x+=2) {
        const i = (y*w + x)*4;
        if (classifyPixel(data[i],data[i+1],data[i+2]) === 'white') {
          return { x, y };
        }
      }
    }
    // fallback: first blue pixel
    for (let y=0; y<h; y+=2) {
      for (let x=0; x<w; x+=2) {
        const i = (y*w + x)*4;
        if (classifyPixel(data[i],data[i+1],data[i+2]) === 'blue') {
          return { x, y };
        }
      }
    }
    // absolute fallback: center
    return { x: w*0.5, y: h*0.5 };
  }

  /* ---------------------------- INPUTS --------------------------- */
  function bindInputs() {
    window.addEventListener('keydown', (e) => {
      state.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape') {
        toggleOverlay(els.ovHelp, true);
      }
      // Start interaction
      if (e.key.toLowerCase() === 'e') {
        tryInteract();
      }
    });
    window.addEventListener('keyup', (e) => {
      state.keys[e.key.toLowerCase()] = false;
    });
  }

  function bindOverlayButtons() {
    els.btnHelp?.addEventListener('click', () => toggleOverlay(els.ovHelp, true));
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sel = btn.getAttribute('data-close');
        const el = document.querySelector(sel);
        el && toggleOverlay(el, false);
      });
    });

    els.btnReset?.addEventListener('click', resetZone);
    els.resultsClose?.addEventListener('click', () => toggleOverlay(els.ovResults, false));

    // Cutting
    els.cutCancel?.addEventListener('click', () => endCutting(false));
    els.cutConfirm?.addEventListener('click', () => endCutting(true));

    // Bolting
    els.boltCancel?.addEventListener('click', () => endBolting(false));
    els.boltConfirm?.addEventListener('click', () => endBolting(true));
  }

  /* -------------------------- GAME LOOP -------------------------- */
  function loop(ts) {
    const dt = Math.min(0.033, (ts - state.lastTS)/1000);
    state.lastTS = ts;

    updatePlayer(dt);
    updateCamera(dt);
    drawWorld();
    positionDecor(); // pips, avatar

    requestAnimationFrame(loop);
  }

  /* ---------------------- PLAYER & CAMERA ------------------------ */
  function updatePlayer(dt) {
    // Velocity from inputs
    const k = state.keys;
    let vx = 0, vy = 0;
    if (k['w'] || k['arrowup']) vy -= 1;
    if (k['s'] || k['arrowdown']) vy += 1;
    if (k['a'] || k['arrowleft']) vx -= 1;
    if (k['d'] || k['arrowright']) vx += 1;

    const mag = Math.hypot(vx, vy) || 1;
    vx /= mag; vy /= mag;

    const sprint = !!k['shift'];
    const speed = CONFIG.speed * (sprint ? CONFIG.sprintMult : 1);
    let nx = state.player.x + vx * speed * dt;
    let ny = state.player.y + vy * speed * dt;

    // Clamp to walkable by sampling mask at next position
    if (isWalkable(nx, ny)) {
      state.player.x = nx; state.player.y = ny;
      state.player.moving = (vx !== 0 || vy !== 0);
    } else {
      state.player.moving = false;
    }

    // Near a hotspot? update HUD hint
    const hs = getNearestHotspotWithin(CONFIG.hotspotProximity);
    if (hs) {
      els.hudMsg.textContent = `Press E to ${hs.type === 'cut' ? 'Cut' : 'Unbolt'}.`;
    } else {
      els.hudMsg.textContent = 'Walk to a highlighted part to begin.';
    }
  }

  function isWalkable(wx, wy) {
    const x = Math.round(wx), y = Math.round(wy);
    if (x<0||y<0||x>=state.baseW||y>=state.baseH) return false;
    const d = state.maskCtx.getImageData(x, y, 1, 1).data;
    return classifyPixel(d[0], d[1], d[2]) === 'blue';
  }

  function getNearestHotspotWithin(radius) {
    let best = null, bestD = Infinity;
    for (const hs of state.hotspots) {
      if (hs.completed) continue;
      const dx = hs.cx - state.player.x;
      const dy = hs.cy - state.player.y;
      const d = Math.hypot(dx, dy);
      if (d < radius && d < bestD) {
        best = hs; bestD = d;
      }
    }
    return best;
  }

  function updateCamera(dt) {
    const vw = els.world.clientWidth;
    const vh = els.world.clientHeight;
    // Lerp camera center to player
    const targetX = state.player.x - vw * 0.5;
    const targetY = state.player.y - vh * 0.5;
    state.cam.x += (targetX - state.cam.x) * CONFIG.camLerp;
    state.cam.y += (targetY - state.cam.y) * CONFIG.camLerp;

    // Clamp camera to world bounds
    state.cam.x = Math.max(0, Math.min(state.cam.x, state.baseW - vw));
    state.cam.y = Math.max(0, Math.min(state.cam.y, state.baseH - vh));
  }

  function centerCameraInstant() {
    const vw = els.world.clientWidth;
    const vh = els.world.clientHeight;
    state.cam.x = Math.max(0, Math.min(state.player.x - vw*0.5, state.baseW - vw));
    state.cam.y = Math.max(0, Math.min(state.player.y - vh*0.5, state.baseH - vh));
  }

  /* --------------------------- RENDER ---------------------------- */
  function drawWorld() {
    const ctx = els.world.getContext('2d');
    ctx.clearRect(0,0,els.world.width, els.world.height);

    // Draw base image at camera offset
    ctx.drawImage(
      els.imgBase,
      state.cam.x, state.cam.y, els.world.clientWidth, els.world.clientHeight,
      0, 0, els.world.clientWidth, els.world.clientHeight
    );

    // Optional: debug show hotspots centers
    // ctx.fillStyle = 'rgba(255,0,0,.5)';
    // for (const hs of state.hotspots) {
    //   if (hs.completed) continue;
    //   const s = worldToScreen(hs.cx, hs.cy);
    //   ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI*2); ctx.fill();
    // }
  }

  function positionDecor() {
    // Avatar position
    const a = worldToScreen(state.player.x, state.player.y);
    avatarEl.style.left = `${a.x}px`;
    avatarEl.style.top = `${a.y}px`;

    // Pips
    for (const hs of state.hotspots) {
      if (!hs.pipEl) continue;
      hs.pipEl.style.display = hs.completed ? 'none' : 'block';
      const s = worldToScreen(hs.cx, hs.cy);
      hs.pipEl.style.left = `${s.x}px`;
      hs.pipEl.style.top = `${s.y}px`;
    }
  }

  function worldToScreen(wx, wy) {
    return {
      x: Math.round(wx - state.cam.x),
      y: Math.round(wy - state.cam.y),
    };
  }

  /* ------------------------- INTERACTION ------------------------- */
  function tryInteract() {
    const hs = getNearestHotspotWithin(CONFIG.hotspotProximity);
    if (!hs) return;
    state.activeHotspot = hs;
    els.dockTask.textContent = `Active Task: ${hs.type === 'cut' ? 'Precision Cutting' : 'Bolt Removal'}`;
    if (hs.type === 'cut') startCutting(hs);
    else startBolting(hs);
  }

  /* ---------------------- MINIGAME: CUTTING ---------------------- */
  function startCutting(hs) {
    toggleOverlay(els.ovCut, true);
    els.cutConfirm.disabled = true;

    const c = els.cutCanvas;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;

    // Generate a wavy path from left to right
    const pts = [];
    const seg = CONFIG.cut.pathSegments;
    for (let i=0; i<=seg; i++) {
      const x = (W/seg)*i;
      const y = H*0.5 + Math.sin(i*0.9)*H*0.18 + (Math.random()-0.5)*H*0.08;
      pts.push({x,y});
    }

    // Sample checkpoints along the path to measure coverage
    const checkpoints = [];
    const totalCP = 60;
    for (let i=0; i<totalCP; i++) {
      const t = i/(totalCP-1);
      // interpolate along polyline
      const f = t*seg;
      const i0 = Math.floor(f);
      const i1 = Math.min(seg, i0+1);
      const lt = f - i0;
      const x = pts[i0].x*(1-lt) + pts[i1].x*lt;
      const y = pts[i0].y*(1-lt) + pts[i1].y*lt;
      checkpoints.push({x,y, hit:false});
    }
    state.mgCut.checkpoints = checkpoints;
    state.mgCut.hits = 0;
    state.mgCut.total = totalCP;

    // Draw base once
    function drawBase() {
      ctx.clearRect(0,0,W,H);
      // background panel
      ctx.fillStyle = '#09111c';
      ctx.fillRect(0,0,W,H);
      // path
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#2b6ff0';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

      // checkpoints
      ctx.fillStyle = 'rgba(255,255,255,.15)';
      for (const cp of checkpoints) {
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 3, 0, Math.PI*2);
        ctx.fill();
      }
    }
    drawBase();

    // Track mouse proximity to checkpoints
    function onMove(e) {
      const rect = c.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (c.width / rect.width);
      const my = (e.clientY - rect.top)  * (c.height / rect.height);

      let changed = false;
      for (const cp of checkpoints) {
        if (!cp.hit) {
          const d = Math.hypot(mx - cp.x, my - cp.y);
          if (d <= CONFIG.cut.tolerance) {
            cp.hit = true; changed = true;
          }
        }
      }
      if (changed) {
        // re-draw hits overlay
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(123,211,255,.22)';
        for (const cp of checkpoints) {
          if (cp.hit) {
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 4.2, 0, Math.PI*2);
            ctx.fill();
          }
        }
        ctx.restore();
        const hitCount = checkpoints.filter(cp=>cp.hit).length;
        state.mgCut.hits = hitCount;
        const coverage = hitCount / totalCP;
        els.cutConfirm.disabled = (coverage < CONFIG.cut.minCoverage);
      }
    }
    c.addEventListener('mousemove', onMove);
    // store remover to detach later
    els.cutCanvas._onMove = onMove;
  }

  function endCutting(success) {
    // cleanup listener
    if (els.cutCanvas._onMove) {
      els.cutCanvas.removeEventListener('mousemove', els.cutCanvas._onMove);
      els.cutCanvas._onMove = null;
    }
    toggleOverlay(els.ovCut, false);
    if (!success) { els.dockTask.textContent = 'None'; return; }

    const coverage = state.mgCut.hits / (state.mgCut.total || 1);
    const yieldUnits = Math.round(40 + 70*coverage);    // 40–110
    const qualityHit = Math.round((1-coverage)*10);      // up to -10%

    state.salvage += yieldUnits;
    state.crates += 1;
    state.quality = Math.max(0, state.quality - qualityHit);

    finishHotspotSuccess(`Cut complete • Precision ${(coverage*100)|0}% • +${yieldUnits} salvage`);

    updateHUD();
  }

  /* ---------------------- MINIGAME: BOLTING ---------------------- */
  function startBolting(hs) {
    toggleOverlay(els.ovBolt, true);
    els.boltConfirm.disabled = true;
    els.boltProgress.style.width = '0%';

    // generate sequence
    const len = randInt(CONFIG.bolt.minLen, CONFIG.bolt.maxLen);
    const seq = [];
    for (let i=0; i<len; i++) {
      seq.push(CONFIG.bolt.keys[Math.floor(Math.random()*CONFIG.bolt.keys.length)]);
    }
    state.mgBolt.seq = seq;
    state.mgBolt.idx = 0;
    state.mgBolt.total = len;
    state.mgBolt.successCount = 0;
    state.mgBolt.running = true;

    renderBoltSeq();

    // listen to keys
    function handler(e) {
      if (!state.mgBolt.running) return;
      const key = e.key.toUpperCase();
      const target = state.mgBolt.seq[state.mgBolt.idx];
      if (!target) return;

      if (key === target) {
        state.mgBolt.idx++;
        state.mgBolt.successCount++;
        renderBoltSeq();
        els.boltProgress.style.width = `${(state.mgBolt.idx/len)*100}%`;
        if (state.mgBolt.idx >= len) {
          // completed
          els.boltConfirm.disabled = false;
          state.mgBolt.running = false;
          window.removeEventListener('keydown', handler);
        }
      } else {
        // wrong key → small penalty by moving back one (but not below 0)
        state.mgBolt.idx = Math.max(0, state.mgBolt.idx - 1);
        renderBoltSeq();
        els.boltProgress.style.width = `${(state.mgBolt.idx/len)*100}%`;
      }
    }
    window.addEventListener('keydown', handler);
    els.boltSeq._handler = handler;

    // per-key timeout (soft pressure)
    state.mgBolt.timer = setInterval(() => {
      if (!state.mgBolt.running) return;
      state.mgBolt.idx = Math.max(0, state.mgBolt.idx - 1);
      renderBoltSeq();
      els.boltProgress.style.width = `${(state.mgBolt.idx/len)*100}%`;
    }, CONFIG.bolt.perKeyWindowMs);
  }

  function renderBoltSeq() {
    const seq = state.mgBolt.seq;
    const idx = state.mgBolt.idx;
    const parts = seq.map((k, i) => {
      if (i < idx) return `<span style="opacity:.35">${k}</span>`;
      if (i === idx) return `<span style="color:#7bd3ff;text-shadow:0 0 6px rgba(123,211,255,.6)">${k}</span>`;
      return `<span>${k}</span>`;
    });
    els.boltSeq.innerHTML = parts.join(' ');
  }

  function endBolting(success) {
    // cleanup
    if (els.boltSeq._handler) {
      window.removeEventListener('keydown', els.boltSeq._handler);
      els.boltSeq._handler = null;
    }
    if (state.mgBolt.timer) {
      clearInterval(state.mgBolt.timer);
      state.mgBolt.timer = null;
    }
    state.mgBolt.running = false;

    toggleOverlay(els.ovBolt, false);
    if (!success) { els.dockTask.textContent = 'None'; return; }

    const eff = (state.mgBolt.successCount / (state.mgBolt.total || 1));
    const yieldUnits = Math.round(35 + 75*eff);    // 35–110
    const qualityHit = Math.round((1-eff)*8);      // up to -8%

    state.salvage += yieldUnits;
    state.crates += 1;
    state.quality = Math.max(0, state.quality - qualityHit);

    finishHotspotSuccess(`Bolts removed • Timing ${(eff*100)|0}% • +${yieldUnits} salvage`);
    updateHUD();
  }

  /* ------------------------- UTILITIES --------------------------- */
  function toggleOverlay(el, show) {
    if (!el) return;
    el.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  function toast(msg, kind='ok') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = msg;
    toasts.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function updateHUD() {
    els.hudSalvage.textContent = state.salvage;
    els.hudQuality.textContent = `${state.quality}%`;
    els.hudCrates.textContent = state.crates;
  }

  function resetZone() {
    // Reset progress but keep islands
    for (const hs of state.hotspots) {
      hs.completed = false;
      if (hs.pipEl) hs.pipEl.style.display = 'block';
    }
    state.salvage = 0;
    state.crates = 0;
    state.quality = 100;
    els.dockTask.textContent = 'None';
    updateHUD();
    toast('Zone reset.');
  }

  function finishHotspotSuccess(msg) {
    if (!state.activeHotspot) return;
    state.activeHotspot.completed = true;
    if (state.activeHotspot.pipEl) state.activeHotspot.pipEl.style.display = 'none';
    toast(msg, 'ok');
    els.dockTask.textContent = 'None';

    // If all hotspots completed: show simple results
    const remaining = state.hotspots.filter(h=>!h.completed).length;
    if (remaining === 0) {
      showResults();
    }
  }

  function showResults() {
    els.resultsList.innerHTML = `
      <li>Total salvage: <b>${state.salvage}</b></li>
      <li>Crates prepared: <b>${state.crates}</b></li>
      <li>Quality impact: <b>${state.quality}%</b></li>
      <li>Hotspots completed: <b>${state.hotspots.length}</b></li>
    `;
    toggleOverlay(els.ovResults, true);
  }

  function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }

  /* -------------------------- BOOTSTRAP -------------------------- */
  loadImages();
})();
