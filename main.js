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

// Debug: confirm this file was fetched and executed
// Debug log helpers (respect CONFIG.debugLogs)
const __dbg = { log: (...a)=>{ try{ if (typeof CONFIG!=='undefined' && CONFIG.debugLogs) console.log(...a); }catch{} },
                 warn: (...a)=>{ try{ if (typeof CONFIG!=='undefined' && CONFIG.debugLogs) console.warn(...a); }catch{} } };
__dbg.log('[zone1] main.js executing');

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
  blueHeuristic: { minB: 140, maxRG: 120, dominance: 50 },
  greenHeuristic: { minG: 150, maxRB: 120, dominance: 50 },
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
    torque: {
      rotationHz: 1.0,         // rotations per second
      startZoneDeg: 40,        // initial green zone width in degrees
      zoneShrinkDeg: 5,        // shrink per successful hit
      minZoneDeg: 20,          // don't shrink below this width
      successGain: 25,         // progress + on success
      missLoss: 10,            // progress - on miss
      completeAt: 100,         // percent to finish
      failUnder: -10,          // fail threshold (reset if under)
      hitsToLoosen: 4,         // visual bolt rotation segments
      flashMs: 120,            // flash duration for feedback
      timeLimitMs: 15000,      // 15s time limit
    },
    hold: {
      enabled: true,           // allow Hold-the-Frame to trigger
      autoAfter: 'none',       // 'cut' | 'torque' | 'either' | 'none'
      chance: 0.8,             // probability to run after eligible minigame
      bonusSalvage: 30,        // salvage on success (also in endHold)
      qualityFail: 6,          // quality penalty on failure (also in endHold)
      peopleFail: 12,          // people waiting increase on failure (also in endHold)
      timeLimitMs: 20000,      // 20s to secure before failure
      warnAtMs: [6000, 3000],  // warning ticks
      audio: { baseFreq: 55, maxFreq: 160, baseGain: 0.02, maxGain: 0.08 },
      tremor: { amp: 0.006, freq: 2.2 }, // random tremors
      env: { silhouettes: true, crowdHints: true }
    },
  // Visual
  pipEnabled: false, // hide blue pips; we'll render mask overlays instead
    // Carousel layout/animation
    carouselLerp: 0.14,     // how fast the carousel position eases to target
    carouselMaxVisible: 3,  // number of side items drawn on each side (total visible ~ 2*+1)
  carouselSideScale: 0.9,
  // Scale profile: active item is larger; distant items shrink gradually
  carouselCenterScale: 1.18,
  carouselMinScale: 0.6,
  carouselScaleFalloff: 0.22,
    carouselAlphaFalloff: 0.35,
    // Door-based zone switching
    doorMargin: 28,         // px from top-left/right inside the active panel
    doorCooldownMs: 700,
  // Full-bleed mode per zone (draw world edge-to-edge instead of inside a carousel panel)
  fullBleedZones: [0],    // zone indices that render full-bleed; 0 = ZONE 1
    // Overlay colors for dismantle regions (RGBA 0-255)
    overlayColors: {
      activeFill:  [255, 59, 59,  72],   // soft red fill
      activeStroke:[235, 65, 65, 215],   // strong red edge
      doneFill:    [64,  68,  76,  80],  // darker grey fill
      doneStroke:  [48,  52,  60, 220],  // dark grey edge
    },
    overlayFadeMs: 450, // crossfade time from red -> grey (tactile)
    shimmer: {
      enabled: true,
      msMin: 300,
      msMax: 600,
      widthFrac: 0.18,       // fraction of island width
      alpha: 0.12,           // stripe strength
      lineAlpha: 0.18,       // thin cut line alpha
    },
    // Plane overlays (visual tint). Disable to keep background original
    planeOverlays: {
      enabled: false
    },
    // Logistics: crates and truck
    crate: {
      w: 40, h: 40,
      color: '#ff8c2a',
      stroke: '#b85d0f',
      spawnAnimMs: 700,
      glintMs: 900,
      spawnDelayMs: 420,
      glintAlpha: 0.22,
      pickupRadius: 56,
    },
    truck: {
      w: 160, h: 80,
      laneYFrac: 0.74,       // fraction of world height for the truck lane
      parkOffsetX: -180,     // parked position relative to Zone 1 right edge
      speed: 220,            // px/sec base
      speedGain: 10,         // increase after each cycle
      pauseMs: 2000,         // unload pause in Zone 2
      slots: 3,
      bobAmp: 3,
      boundaryLineColor: 'rgba(255,255,255,.2)'
    },
    // Crowd rendering behavior
    crowd: {
      // When true, attempt to keep on-screen agents close to the HUD People Waiting
      // value (capped by maxOnScreen). When false, use pressure-based softCap.
      matchHud: true,
      maxOnScreen: 240,         // safety cap for rendering
      spawnBurst: 12,           // max agents to spawn in a single cadence
      minSpawnIntervalMs: 60,   // lower bound for spawn cadence when catching up
      // Keep some breathing room around the player so followers don't form a blob
      playerStandoffRadius: 84, // px; agents try not to enter this circle
      orbitBand: { min: 76, max: 120 }, // preferred ring where agents distribute
      // High-count tuning to keep perf stable
      highN: {
        // Separation iterations vs. population size thresholds
        sep0: 2,   // <=80 agents
        sep1: 1,   // 81..140
        sep2: 1,   // >140 (ensure at least one pass)
        t1: 80,
        t2: 140,
        // Repath timing baseline and jitter; scaled up at high N
        repathBaseMs: 1400,
        repathJitterMs: 1400,
        // Cap agent max speed (helps stabilize large crowds)
        maxSpeed: 52
      }
    },
    // Avatar sprite (player)
    avatar: {
      heightPx: 50, // on-screen height for the player figure
      preferredName: 'figure5.png'
    },
    debugLogs: false
  };

  /* ----------------------------- DOM ----------------------------- */
  const els = {
    world: document.getElementById('world'),
    fx: document.getElementById('fx'),
    imgBase: document.getElementById('img-base'),
  imgMask: document.getElementById('img-mask'),
  imgBase2: document.getElementById('img-base2'),
    hudMsg: document.getElementById('hud-msg'),
    hudSalvage: document.getElementById('hud-salvage'),
    hudQuality: document.getElementById('hud-quality'),
    hudCrates: document.getElementById('hud-crates'),
    hudPeople: document.getElementById('hud-people'),
    viewport: document.getElementById('viewport'),
    voices: document.getElementById('voices'),
    dockTask: document.getElementById('task'),
    // overlays
    ovHelp: document.getElementById('overlay-help'),
    ovCut: document.getElementById('overlay-cut'),
  ovBolt: document.getElementById('overlay-bolt'),
  ovResults: document.getElementById('overlay-results'),
  ovHold: document.getElementById('overlay-hold'),
    cutCanvas: document.getElementById('cut-canvas'),
    cutConfirm: document.getElementById('cut-confirm'),
    cutCancel: document.getElementById('cut-cancel'),
  torqueCanvas: document.getElementById('torque-canvas'),
  torqueReadout: document.getElementById('torque-readout'),
  torqueCancel: document.getElementById('torque-cancel'),
  holdCanvas: document.getElementById('hold-canvas'),
  holdCancel: document.getElementById('hold-cancel'),
    resultsList: document.getElementById('results-list'),
    resultsClose: document.getElementById('results-close'),
    btnHelp: document.getElementById('btn-help'),
    btnReset: document.getElementById('btn-reset'),
    btnContinue: document.getElementById('btn-continue'),
    // plane overlays
    plane1: document.getElementById('plane-overlay-1'),
    plane2: document.getElementById('plane-overlay-2'),
    plane3: document.getElementById('plane-overlay-3'),
  };

  // Create avatar element (styled by CSS you pasted)
  const avatarEl = document.createElement('div');
  // Use a new id so any old #avatar CSS (orange circle) won't apply
  avatarEl.id = 'player-avatar';
  avatarEl.style.position = 'absolute';
  avatarEl.style.pointerEvents = 'none';
  avatarEl.style.transform = 'translate(-50%, -100%)'; // bottom-center anchor
  avatarEl.style.display = 'inline-block';
  avatarEl.style.background = 'transparent';
  avatarEl.style.border = '0';
  avatarEl.style.borderRadius = '0';
  avatarEl.style.boxShadow = 'none';
  avatarEl.style.width = 'auto';
  avatarEl.style.height = 'auto';
  const avatarImg = document.createElement('img');
  avatarImg.alt = '';
  avatarImg.style.display = 'block';
  avatarImg.style.height = `${24}px`; // will be updated from CONFIG
  avatarImg.style.width = 'auto';
  avatarImg.style.filter = 'none';
  avatarImg.style.userSelect = 'none';
  avatarEl.appendChild(avatarImg);
  els.viewport.appendChild(avatarEl);

  // Make viewport focusable and add a click-to-focus hint (helps keyboard input on some setups)
  try {
    els.viewport.setAttribute('tabindex', '0');
    els.viewport.addEventListener('click', () => {
      els.viewport.focus();
      toast('Viewport focused — use WASD or arrow keys to move', 'ok');
    });
  } catch (e) {
    // ignore if viewport not present
  }

  // Small debug overlay (temporary) to show player state and keys
  const debugEl = document.createElement('div');
  debugEl.id = 'zone-debug';
  debugEl.style.position = 'fixed';
  debugEl.style.right = '12px';
  debugEl.style.bottom = '12px';
  debugEl.style.padding = '8px 10px';
  debugEl.style.background = 'rgba(0,0,0,.6)';
  debugEl.style.color = '#9fd';
  debugEl.style.fontFamily = 'monospace';
  debugEl.style.fontSize = '12px';
  debugEl.style.zIndex = '9999';
  debugEl.style.borderRadius = '6px';
  debugEl.style.pointerEvents = 'none';
  debugEl.textContent = 'debug';
  document.body.appendChild(debugEl);

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
    // logistics system
    cargoCrates: [],          // {id,x,y,w,h,carrying,loaded,alpha}
    nextCrateId: 1,
    carryingCrateId: null,
    truck: {
      x: 0, y: 0, w: 160, h: 80,
      slots: [],            // [{id, dx, dy}]
      inTransit: false,
      tState: 'parked',     // parked|depart|moveOut|pause|unload|return|arrive
      t0: 0,
      speed: 220,
      delivered: 0,
      _outTargetX: null,
      _crossed: false
    },
    zoneBoundaryX: 0,         // world x where Zone 1 meets Zone 2
    zone2Inventory: 0,
    cratesLoaded: 0,
    // game stats
    salvage: 0,
    crates: 0,
    quality: 100,
    activeHotspot: null,
    lastTS: 0,
    // minigames
    mgCut: { checkpoints: [], hits: 0, total: 0 },
    mgTorque: {
      running: false,
      progress: 0,   // 0..100
      hits: 0,
      misses: 0,
      zoneStart: 0,  // radians
      zoneEnd: 0,    // radians
      zoneWidthDeg: 40,
      angle: 0,      // current needle angle (radians)
      lastRot: 0,    // track full rotation for re-randomizing zone
      flashKind: '', // 'hit' | 'miss'
      flashUntil: 0,
      boltAngle: 0,  // visual bolt loosen angle
      rafId: 0,
      loopId: 0,
      animId: 0,
      closeTimeoutId: null,
      deadline: 0,
    },
    mgHold: {
      running: false,
      angle: 0,          // radians tilt
      angVel: 0,         // radians/sec
      sway: 0,           // external disturbance accumulator
      clampsAt: 0,       // timestamp when stable long enough
      stableFor: 0,      // ms accumulated in stable zone
      fail: false,
      raf: 0,
      startAt: 0,
      threshold: { amber: 0.18, red: 0.32 },
      requireMs: 4000,   // hold stable for 4s
      deadline: 0,
      lastWarnAt: 0,
      bgT: 0,
      sparks: [],
      lastZone: 'white'
    },
    // debug
    debugIgnoreMask: false, // Nav mesh enabled - character respects walkable areas
    // walkability mode: default to 'blue' and auto-fallback to 'lum' if mask has no blue
    walkableMode: 'blue',
    walkLumThreshold: 210,
  strictMaskColors: false,
  maskFallbackTried: false,
    // gallery view
    activeZone: 0,
    zones: Array.from({length:8}, (_,i)=>({ id:i, name:`ZONE ${i+1}` })),
    // view mapping (world -> screen) for gallery center panel
    view: { x:0, y:0, w:0, h:0, scale:1 },
    autoZone: false,        // door-based switching prefers manual or door-only
    carouselPos: 0, // floats toward activeZone for smooth transitions
    manualNav: false,       // disable keyboard zone nav unless enabled
    lastDoorSwitchTs: 0,
    // particles
    particles: [], // { wx, wy, angle, dist, size, color, t, dur, type }
    // Plane overlay arrivals
    planeImgs: [],       // [HTMLImageElement]
    overlays: [],        // [{img, alpha, xOff, yOff, greyed}]
    planeTimerMs: 30000, // 30s cycle
    nextArrivalAt: 0,
    planeClearedPauseMs: 5000,
    planeClearedUntil: 0,
    humGain: 0,          // 0..1
    lastHumT: 0,
    // Crowd assets & world-anchored agents
    silImgs: [],           // loaded silhouette images (for agents)
    pressure: 0,           // 0..1 index
    // Navmesh grid (Zone 1)
    nav: { gridW: 0, gridH: 0, cell: 12, walk: null },
    // Agents following navmesh to the player
    agents: [],            // [{id, wx, wy, speed, r, img, drawW, drawH, path:[], pi, nextRepathAt, flip, alpha, state}]
    nextAgentAt: 0,        // ms when another can spawn
    agentIdSeq: 1,
    // People counter
    peopleWaiting: 0,
    _peopleAcc: 0,
    _nextPeopleTickAt: 0,
    // Voices
    voiceBubbles: [],      // [{wx, wy, text, el, until, tone}]
    _nextAmbientAt: 0,
    // Crisis voice pacing
    lastShipmentAt: 0,
    _lastHeavyAt: 0,
    _heavyMilestone: 0,
    // Visual Residue System
    residueCan: null,
    residueCtx: null,
    residueScore: 0,       // grows with stamps; used for wash
    _lastResidueAgeAt: 0,
  };

  /* ----------------------- IMAGE LOADING ------------------------- */
  function loadImages() {
  __dbg.log('[zone1] loadImages: waiting for base and mask to load');
    const promises = [els.imgBase, els.imgMask, els.imgBase2, els.plane1, els.plane2, els.plane3].filter(Boolean).map(img => {
      return new Promise(res => {
        if (img.complete && img.naturalWidth) return res();
        img.onload = () => res();
        img.onerror = () => res(); // fail-safe
      });
    });
    Promise.all(promises).then(() => {
  __dbg.log('[zone1] loadImages: images settled', {
        baseW: els.imgBase.naturalWidth, baseH: els.imgBase.naturalHeight,
        maskW: els.imgMask.naturalWidth, maskH: els.imgMask.naturalHeight,
        base2W: els.imgBase2?.naturalWidth, base2H: els.imgBase2?.naturalHeight
      });
      initAfterImages();
    });
  }

  /* --------------------------- INIT ------------------------------ */
  function initAfterImages() {
  __dbg.log('[zone1] initAfterImages starting');
    // Base world size from base image
  const base1W = els.imgBase.naturalWidth || 1920;
  const base1H = els.imgBase.naturalHeight || 1080;
  const base2W = (els.imgBase2 && els.imgBase2.naturalWidth) ? els.imgBase2.naturalWidth : 0;
  const base2H = (els.imgBase2 && els.imgBase2.naturalHeight) ? els.imgBase2.naturalHeight : 0;
  state.baseW = base1W + (base2W || 0); // stitched width
  state.baseH = Math.max(base1H, base2H || base1H);
  state.zoneBoundaryX = base1W; // for visuals and truck path
  state.zone1W = base1W;

    // Prepare canvases to match viewport pixel ratio
    resizeCanvases();

    // Prepare mask sampling
  state.maskCanvas.width = base1W; // only Zone 1 mask for now
  state.maskCanvas.height = base1H;
    state.maskCtx = state.maskCanvas.getContext('2d', { willReadFrequently: true });
  state.maskCtx.drawImage(els.imgMask, 0, 0, base1W, base1H);
    // If mask is PNG, prefer strict colors
    try{
      const src = (els.imgMask.getAttribute('src')||'').split('?')[0].toLowerCase();
      state.strictMaskColors = src.endsWith('.png');
    }catch{ state.strictMaskColors = false; }

    // Build islands: RED = hotspots, YELLOW = logistics
    buildIslands();
  __dbg.log('[zone1] buildIslands -> hotspots:', state.hotspots.length, 'logistics:', state.logistics.length);

    // Build a coarse navmesh grid for world-anchored crowd
  try { buildNavMesh(); __dbg.log('[zone1] navmesh grid', state.nav.gridW, 'x', state.nav.gridH, 'cell', state.nav.cell); } catch(e){ __dbg.warn('navmesh build failed', e); }

    // Spawn point: WHITE pixel (or fallback to first blue)
  const spawn = getSpawnPoint();
  __dbg.log('[zone1] spawn point:', spawn);
    state.player.x = spawn.x;
    state.player.y = spawn.y;
  __dbg.log('[zone1] player position set to:', state.player.x, state.player.y);
  try { toast(`Spawned at (${spawn.x|0}, ${spawn.y|0})`, 'ok'); } catch {}

    // Camera start centered on player
    centerCameraInstant();
  __dbg.log('[zone1] camera centered at:', state.cam.x, state.cam.y);

    // Events
    bindInputs();
    bindOverlayButtons();
  initLogistics();
    initPlaneOverlays();
    // Create world-anchored residue canvas (stitches both zones if present)
    try{
      state.residueCan = document.createElement('canvas');
      state.residueCan.width = state.baseW;
      state.residueCan.height = state.baseH;
      state.residueCtx = state.residueCan.getContext('2d');
      // start transparent
      state.residueCtx.clearRect(0,0,state.baseW,state.baseH);
      state._lastResidueAgeAt = performance.now();
    }catch{}

    // Initialize timers for voice context
    state.lastShipmentAt = performance.now();
    state._lastHeavyAt = 0;
    state._heavyMilestone = 0;

    // Listen for shipments to adjust people counter and trigger voices
    try {
      document.addEventListener('shipmentComplete', (ev) => {
        const count = (ev?.detail?.count) || CONFIG.truck.slots;
        adjustPeopleWaiting(-count * 4, { reason: 'shipment' });
        state.lastShipmentAt = performance.now();
        // Cheer near truck
        const tx = state.truck.x + state.truck.w * 0.5;
        const ty = state.truck.y + state.truck.h * 0.2;
        speakAt(`−${count*4} housed`, tx, ty, 'good');
        // Nearby agents positive phrases
        burstVoicesNear(tx, ty, 3, 'positive');
      });
    } catch{}

    // Start loop
    state.loaded = true;
  state.carouselPos = state.activeZone;
    state.lastTS = performance.now();
    requestAnimationFrame(loop);

    toast('Loaded Zone 1. Walk to a red outlined part and press E.', 'ok');
    updateHUD();
      loadSilhouetteImages();
    // Configure avatar sprite now (and once silhouettes finish loading)
    try{ setAvatarSprite(); }catch{}
    // If silhouettes load later, try again to pick the exact figure5 if available
    setTimeout(()=>{ try{ setAvatarSprite(); }catch{} }, 1200);
  }

  function initPlaneOverlays(){
    state.planeImgs = [els.plane1, els.plane2, els.plane3].filter(Boolean);
    state.overlays = [];
    state.nextArrivalAt = performance.now() + state.planeTimerMs;
    state.planeClearedUntil = 0;
    state.humGain = 0; state.lastHumT = 0;
  }

  function initLogistics(){
    // Place truck parked near the Zone 1 → Zone 2 boundary
    const laneY = state.baseH * CONFIG.truck.laneYFrac;
    state.truck.w = CONFIG.truck.w;
    state.truck.h = CONFIG.truck.h;
    state.truck.x = (state.zoneBoundaryX + CONFIG.truck.parkOffsetX);
    state.truck.y = laneY - state.truck.h/2;
    state.truck.speed = CONFIG.truck.speed;
    state.truck.slots = []; state.truck.inTransit = false; state.truck.tState = 'parked';
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
    const T = state.strictMaskColors ? Math.min(5, tol) : tol;
    return Math.abs(r - target[0]) <= T &&
           Math.abs(g - target[1]) <= T &&
           Math.abs(b - target[2]) <= T;
  }
  function isBlue(r,g,b){
    // PNG strict: only pure bright blue
    if (state.strictMaskColors) return (r===0 && g===0 && b===255) || isApproxColor(r,g,b,[0,0,255], 2);
    // Otherwise, accept pure bright blue or dominant blue channel
    if (isApproxColor(r,g,b,[0,0,255])) return true;
    const h = CONFIG.blueHeuristic;
    return (b >= h.minB) && (Math.max(r,g) <= h.maxRG) && ((b - Math.max(r,g)) >= h.dominance);
  }
  function isGreen(r,g,b){
    if (state.strictMaskColors) return (r===0 && g===255 && b===0) || isApproxColor(r,g,b,[0,255,0], 2);
    if (isApproxColor(r,g,b,[0,255,0])) return true;
    const h = CONFIG.greenHeuristic;
    return (g >= h.minG) && (Math.max(r,b) <= h.maxRB) && ((g - Math.max(r,b)) >= h.dominance);
  }
  function classifyPixel(r, g, b) {
    // BLUE walkable, RED hotspot, YELLOW logistics, WHITE spawn
    if (isBlue(r,g,b)) return 'blue';
    if (isApproxColor(r,g,b, [255,0,0])) return 'red';
    if (isApproxColor(r,g,b, [255,255,0])) return 'yellow';
    if (isGreen(r,g,b)) return 'green';
    if (isApproxColor(r,g,b, [255,255,255], 30)) return 'white';
    return 'other';
  }

  /* ------------------------ ISLAND BUILDING ---------------------- */
  function buildIslands() {
    const ctx = state.maskCtx;
    const w = state.maskCanvas.width, h = state.maskCanvas.height;
    const img = ctx.getImageData(0,0,w,h);
    const data = img.data;
    const seen = new Uint8Array(w*h);
    // stats to detect if mask actually contains blue walkable pixels
    let blueCount = 0;
    let sampleCount = 0;
    let redPixels = 0;

    const getIdx = (x,y) => (y*w + x);
    const getRGB = (x,y) => {
      const i = getIdx(x,y)*4;
      return [data[i], data[i+1], data[i+2]];
    };

  let hotspotCount = 0;

    for (let y=0; y<h; y+=1) {
      for (let x=0; x<w; x+=1) {
        const idx = getIdx(x,y);
        if (seen[idx]) continue;
        const [r,g,b] = getRGB(x,y);
  const cls = classifyPixel(r,g,b);
  // accumulate stats
  if (cls === 'blue') blueCount++;
  sampleCount++;
  if (cls !== 'red' && cls !== 'yellow') { seen[idx]=1; continue; }
  if (cls === 'red') redPixels++;

        // Flood fill this island
        const q = [[x,y]];
        seen[idx]=1;
        let area=0, sumx=0, sumy=0, minx=x, miny=y, maxx=x, maxy=y;
        // collect pixels for RED islands to render overlays later
        const pixels = [];

        while (q.length) {
          const [cx, cy] = q.pop();
          area++;
          sumx += cx; sumy += cy;
          if (cx<minx) minx=cx; if (cy<miny) miny=cy;
          if (cx>maxx) maxx=cx; if (cy>maxy) maxy=cy;
          if (cls === 'red') { pixels.push(cx, cy); }

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
          // Cycle hotspot types: cut → bolt → hold
          const mod = hotspotCount % 3;
          const type = mod === 0 ? 'cut' : (mod === 1 ? 'bolt' : 'hold');
          const spot = {
            id: `hs_${hotspotCount}`,
            cx, cy, area, type, completed: false, pipEl: null,
            bbox: { minx, miny, maxx, maxy },
            overlayActive: null,
            overlayDone: null,
            fadeStartTs: 0,
            fadeEndTs: 0,
            fadeDur: 0,
          };
          // build pre-rendered overlays for active/complete states
          try {
            const overlays = makeIslandOverlays(pixels, minx, miny, maxx, maxy);
            spot.overlayActive = overlays.active;
            spot.overlayDone = overlays.done;
          } catch(e) { __dbg.warn('overlay build failed', e); }
          state.hotspots.push(spot);
          hotspotCount++;
        }

        if (cls === 'yellow' && area >= 60) {
          state.logistics.push({ cx: sumx/area, cy: sumy/area, area });
        }
      }
    }

    // If strict PNG mode found nothing recognizable, fallback to tolerant matching once
    if (state.strictMaskColors && !state.maskFallbackTried && blueCount === 0 && hotspotCount === 0 && redPixels === 0) {
      state.maskFallbackTried = true;
      state.strictMaskColors = false;
  __dbg.warn('[zone1] Mask strict mode found no pure colors. Falling back to tolerant matching.');
      toast('Mask colors not detected. Using tolerant matching…', 'warn');
      // reset and rebuild
      state.hotspots = [];
      state.logistics = [];
      return buildIslands();
    }

    // Pips creation skipped (visual overlays will indicate hotspots)

    // Auto-select walkable mode: prefer BLUE if any blue exists at all
    if (blueCount > 0) {
      state.walkableMode = 'blue';
  __dbg.log('[zone1] Using blue walkability. blueCount=', blueCount);
      toast('Nav: blue walkability engaged', 'ok');
    } else {
      state.walkableMode = 'lum';
      state.walkLumThreshold = 210; // treat bright areas as walkable
  __dbg.warn('[zone1] No blue in mask. Using luminance walkability.');
      toast('Nav: luminance walkability (mask has no blue)', 'ok');
    }
  }

  // Build offscreen overlays for a red island region (active red and completed grey)
  function makeIslandOverlays(pixels, minx, miny, maxx, maxy){
    const w = (maxx - minx + 1);
    const h = (maxy - miny + 1);
    const mask = new Uint8Array(w*h);
    for (let i=0; i<pixels.length; i+=2){
      const x = pixels[i] - minx;
      const y = pixels[i+1] - miny;
      mask[y*w + x] = 1;
    }

    function buildCanvas(fillRGBA, strokeRGBA){
      const can = document.createElement('canvas');
      can.width = w; can.height = h;
      const ctx = can.getContext('2d');
      const img = ctx.createImageData(w, h);
      const out = img.data;
      for (let y=0; y<h; y++){
        for (let x=0; x<w; x++){
          const idx = y*w + x;
          if (!mask[idx]) continue;
          // boundary check
          const isEdge = (
            x===0 || y===0 || x===w-1 || y===h-1 ||
            !mask[idx-1] || !mask[idx+1] || !mask[idx-w] || !mask[idx+w]
          );
          const [r,g,b,af] = isEdge ? strokeRGBA : fillRGBA;
          const o = idx*4; out[o]=r; out[o+1]=g; out[o+2]=b; out[o+3]=af;
        }
      }
      ctx.putImageData(img, 0, 0);
      return can;
    }

    // colors from CONFIG: active (red), done (dark grey)
    const C = CONFIG.overlayColors;
    const active = buildCanvas(C.activeFill, C.activeStroke);
    const done   = buildCanvas(C.doneFill,   C.doneStroke);
    return { active, done };
  }

  function getSpawnPoint() {
    const ctx = state.maskCtx;
    const w = state.maskCanvas.width, h = state.maskCanvas.height;
    if (!ctx || !w || !h) {
  __dbg.warn('[zone1] getSpawnPoint: invalid mask context or dimensions, using center');
      return { x: 960, y: 540 };
    }
    
    const data = ctx.getImageData(0,0,w,h).data;
    // priority 0: bottom-right most GREEN pixel (explicit start marker)
    for (let y=h-1; y>=0; y--) {
      for (let x=w-1; x>=0; x--) {
        const i = (y*w + x)*4;
        if (classifyPixel(data[i],data[i+1],data[i+2]) === 'green') {
          __dbg.log('[zone1] spawn (bottom-right green) at', x, y);
          return { x, y };
        }
      }
    }
    // priority 1: bottom-right most BLUE pixel (walkable area) — full resolution scan
    for (let y=h-1; y>=0; y--) {
      for (let x=w-1; x>=0; x--) {
        const i = (y*w + x)*4;
        if (classifyPixel(data[i],data[i+1],data[i+2]) === 'blue') {
          __dbg.log('[zone1] spawn (bottom-right blue) at', x, y);
          return { x, y };
        }
      }
    }
    // find white dot
    for (let y=0; y<h; y+=2) {
      for (let x=0; x<w; x+=2) {
        const i = (y*w + x)*4;
        if (classifyPixel(data[i],data[i+1],data[i+2]) === 'white') {
          __dbg.log('[zone1] found white spawn at', x, y);
          return { x, y };
        }
      }
    }
    // fallback: first blue pixel (walkable area)
    for (let y=0; y<h; y++) {
      for (let x=0; x<w; x++) {
        const i = (y*w + x)*4;
        if (classifyPixel(data[i],data[i+1],data[i+2]) === 'blue') {
          __dbg.log('[zone1] found blue spawn at', x, y);
          return { x, y };
        }
      }
    }
    
    // search for any walkable pixel in a spiral from center
    const cx = Math.round(w*0.5), cy = Math.round(h*0.5);
    for (let r = 50; r < Math.min(w,h)/2; r += 20) {
      for (let angle = 0; angle < Math.PI*2; angle += 0.3) {
        const x = Math.round(cx + Math.cos(angle) * r);
        const y = Math.round(cy + Math.sin(angle) * r);
        if (x >= 0 && x < w && y >= 0 && y < h) {
          const i = (y*w + x)*4;
          if (classifyPixel(data[i],data[i+1],data[i+2]) === 'blue') {
            __dbg.log('[zone1] found walkable spawn via spiral search at', x, y);
            return { x, y };
          }
        }
      }
    }
    
    // absolute fallback: center (even if not walkable)
  __dbg.warn('[zone1] no walkable spawn found, using center - press M to toggle mask bypass');
    return { x: cx, y: cy };
  }

  /* ---------------------------- INPUTS --------------------------- */
  function bindInputs() {
    window.addEventListener('keydown', (e) => {
  if (CONFIG.debugLogs) __dbg.log('[zone1] keydown', e.key);
      state.keys[e.key.toLowerCase()] = true;
      if (e.key === 'Escape') {
        toggleOverlay(els.ovHelp, true);
      }
      // Start interaction
      if (e.key.toLowerCase() === 'e' || e.key === ' ') {
        // Logistics gets priority: pick up/drop crates if applicable
        if (!tryCrateOrTruckInteract()){
          tryInteract();
        }
      }
      // Toggle debug mask ignore
      if (e.key.toLowerCase() === 'm') {
        state.debugIgnoreMask = !state.debugIgnoreMask;
        toast(`debugIgnoreMask: ${state.debugIgnoreMask}`);
      }
      if (e.key.toLowerCase() === 'n') {
        state.walkableMode = state.walkableMode === 'blue' ? 'lum' : 'blue';
        toast(`walkableMode: ${state.walkableMode}`);
      }
      // gallery navigation via keys is disabled by default; enable with state.manualNav=true
      if (state.manualNav) {
        if ((e.key === ',' || e.key === '<') && !e.shiftKey && !e.altKey && !e.ctrlKey) {
          state.activeZone = Math.max(0, state.activeZone - 1);
        }
        if ((e.key === '.' || e.key === '>') && !e.shiftKey && !e.altKey && !e.ctrlKey) {
          state.activeZone = Math.min(state.zones.length-1, state.activeZone + 1);
        }
        // number keys 1-8 to jump directly
        if (/^[1-8]$/.test(e.key)) {
          state.activeZone = Math.min(state.zones.length-1, Math.max(0, parseInt(e.key,10)-1));
        }
      }
      if (e.key.toLowerCase() === 'g') {
        state.autoZone = !state.autoZone;
        toast(`Gallery auto-center: ${state.autoZone ? 'ON' : 'OFF'}`);
      }
      // Debug: force a heavy voice burst
      if (e.key.toLowerCase() === 'h') {
        forceHeavyBurst();
      }
      // Reload mask (cache-busted) and rebuild islands
      if (e.key.toLowerCase() === 'r') {
        reloadMask();
      }
    });
    window.addEventListener('keyup', (e) => {
  if (CONFIG.debugLogs) __dbg.log('[zone1] keyup', e.key);
      state.keys[e.key.toLowerCase()] = false;
    });
  }

  function reloadMask(){
    try{
      const srcRaw = els.imgMask.getAttribute('src');
      const base = (srcRaw||'').split('?')[0];
      els.imgMask.onload = () => {
        // redraw mask and rebuild islands
        const w = state.maskCanvas.width;
        const h = state.maskCanvas.height;
        state.maskCtx.clearRect(0,0,w,h);
        state.maskCtx.drawImage(els.imgMask, 0, 0, w, h);
        // reset islands
        state.hotspots = [];
        state.logistics = [];
        buildIslands();
  try { buildNavMesh(); } catch{}
        toast('Mask reloaded and islands rebuilt', 'ok');
        // If player stands on a blocked pixel now, respawn
        if (!isWalkable(state.player.x, state.player.y)){
          const spawn = getSpawnPoint();
          state.player.x = spawn.x; state.player.y = spawn.y;
          centerCameraInstant();
          toast('Relocated to a valid spawn due to new mask', 'warn');
        }
      };
      els.imgMask.src = `${base}?v=${Date.now()}`;
  }catch(e){ __dbg.warn('reloadMask failed', e); }
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

  // Torque minigame
  els.torqueCancel?.addEventListener('click', () => endTorque(false));
  // Hold-the-Frame
  els.holdCancel?.addEventListener('click', () => endHold(false));
  }

  /* -------------------------- GAME LOOP -------------------------- */
  function loop(ts) {
    const dt = Math.min(0.033, (ts - state.lastTS)/1000);
    state.lastTS = ts;

    updatePlayer(dt);
    updateCamera(dt);
    updateLogistics(dt);
  updatePlaneArrivals(dt, ts);
    // Smooth carousel position towards activeZone for transitions
    state.carouselPos += (state.activeZone - state.carouselPos) * CONFIG.carouselLerp;
  // Check door triggers to switch zones
  checkZoneDoors(ts);
    drawWorld();
    // Update crowd after world/view has been computed
    updateCrowd(dt, ts);
  drawFX();
    updateVoices();
    positionDecor(); // pips, avatar

    // update debug overlay
    if (debugEl) {
      const keysDown = Object.keys(state.keys).filter(k => state.keys[k]).join(',') || '-';
      const walkable = isWalkable(Math.round(state.player.x), Math.round(state.player.y));
      const avatarPos = `avatar:(${avatarEl.style.left},${avatarEl.style.top})`;
      let cls='?';
      try{
        const x=Math.round(state.player.x), y=Math.round(state.player.y);
        const d=state.maskCtx.getImageData(x,y,1,1).data; cls=classifyPixel(d[0],d[1],d[2]);
      }catch{}
      debugEl.textContent = `x:${state.player.x|0} y:${state.player.y|0} zone:${state.activeZone+1}/8 autoZone:${state.autoZone} moving:${state.player.moving} walkable:${walkable} class:${cls} mode:${state.walkableMode} maskBypass:${state.debugIgnoreMask} ${avatarPos} keys:${keysDown}`;
    }

    requestAnimationFrame(loop);
  }

  /* --------------------------- FX LAYER ------------------------- */
  function spawnBurstAt(wx, wy){
    const count = randInt(12, 20);
    for (let i=0;i<count;i++){
      const ang = Math.random()*Math.PI*2;
      const dist = 20 + Math.random()*20; // 20–40px
      const size = Math.random() < 0.6 ? 2 : 1; // tiny
      const white = Math.random() < 0.75; // mostly white
      const color = white ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.4)';
      const dur = 0.3 + Math.random()*0.2; // 0.3–0.5s
      const type = Math.random() < 0.65 ? 'dot' : 'line';
      state.particles.push({ wx, wy, angle: ang, dist, size, color, t:0, dur, type });
    }
  }

  function easeOutCubic(t){ const u = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1-u, 3); }
  function easeInOutCubic(t){ const u = Math.max(0, Math.min(1, t)); return u < 0.5 ? 4*u*u*u : 1 - Math.pow(-2*u + 2, 3)/2; }

  function drawFX(){
    const cfx = els.fx;
    if (!cfx) return;
    const ctx = cfx.getContext('2d');
    // clear
    ctx.clearRect(0,0,cfx.width,cfx.height);
    // particles
    if (state.particles.length){
      // existing particle draw code remains below
    }

  // Clip to center view so effects stay within the active panel
    ctx.save();
    ctx.beginPath();
    ctx.rect(state.view.x||0, state.view.y||0, state.view.w||cfx.width, state.view.h||cfx.height);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter'; // additive for whites

    const next = [];
    for (const p of state.particles){
      p.t += 1/60; // approximate; visual-only, loop dt is small variations
      const k = easeOutCubic(p.t / p.dur);
      if (p.t >= p.dur) continue;
      const s = worldToScreen(p.wx, p.wy);
      const ox = Math.cos(p.angle) * p.dist * k;
      const oy = Math.sin(p.angle) * p.dist * k;
      const x = s.x + ox;
      const y = s.y + oy;
      // opacity ease-out
      const alpha = 1 - k;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.type === 'line'){
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(p.angle)*4, y + Math.sin(p.angle)*4);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, p.size*0.8, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.restore();
      next.push(p);
    }
    // End of panel-clipped effects
    ctx.restore();
    // World-anchored crowd is drawn on the world canvas for correct z-order
    ctx.globalCompositeOperation = 'source-over';
    state.particles = next;
  }

  /* --------------------- CROWD SILHOUETTES ---------------------- */
  function loadSilhouetteImages(){
    // 1) Prefer DOM-provided images: any <img data-silhouette> or <img class="silhouette">
    try{
      const nodes = Array.from(document.querySelectorAll('img[data-silhouette], img.silhouette'));
      const domImgs = [];
      const waiters = nodes.map(node => new Promise(res => {
        if (node.complete && node.naturalWidth) { domImgs.push(node); return res(); }
        node.onload = () => { domImgs.push(node); res(); };
        node.onerror = () => res();
      }));
      Promise.all(waiters).then(() => {
        if (domImgs.length) {
          state.silImgs = domImgs;
          state.nextSilAt = performance.now() + 1200;
          __dbg.log('[zone1] silhouettes (DOM) loaded:', domImgs.length);
          return;
        }
        // 2) No DOM-provided images; probe common folders sequentially to avoid 404 spam
        probeSilhouetteFolderPatterns();
      });
    } catch {
      probeSilhouetteFolderPatterns();
    }

    function probeSilhouetteFolderPatterns(){
      const imgs = [];
      const toTry = 10;
      let finished = 0;
      function doneOne(){
        finished++;
        if (finished >= toTry){
          state.silImgs = imgs;
          state.nextSilAt = performance.now() + 1500;
          __dbg.log('[zone1] silhouettes (probed) loaded:', imgs.length);
        }
      }
      for (let i=1;i<=toTry;i++){
        const cands = [
          `silhouettes/figure${i}.png`,
          `assets/silhouettes/figure${i}.png`,
          `assets/figures/figure${i}.png`,
          `figure${i}.png`,
        ];
        // Try candidates sequentially, accept first that loads
        let idx = 0; let found = false;
        const tryNext = () => {
          if (idx >= cands.length){ doneOne(); return; }
          const src = cands[idx++];
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => { if (!found){ found = true; imgs.push(img); } doneOne(); };
          img.onerror = () => { tryNext(); };
          img.src = src;
        };
        tryNext();
      }
    }
  }

  function computePressure(){
    // Backlog from crates (not yet loaded or delivered)
    const unshipped = state.cargoCrates.filter(c=>!c.loaded).length;
    const crateP = Math.max(0, Math.min(1, unshipped / 6));
    // Active plane overlays (not greyed)
    const activeOver = state.overlays.filter(o=>!o.greyed).length;
    const planeP = Math.max(0, Math.min(1, activeOver / 3));
    // Quality penalty (lower quality => higher pressure)
    const qualP = 1 - Math.max(0, Math.min(1, state.quality / 100));
    // Imminent arrival adds a small nudge in the last 10s
    let imminence = 0;
    try{
      const now = performance.now();
      const d = (state.nextArrivalAt - now);
      imminence = d <= 10000 ? (1 - Math.max(0, Math.min(1, d/10000))) * 0.3 : 0;
    }catch{}
    // Weighted blend
    const p = (crateP*0.45) + (planeP*0.35) + (qualP*0.20) + imminence;
    return Math.max(0, Math.min(1, p));
  }

  // WORLD-ANCHORED CROWD SYSTEM
  function updateCrowd(dt, ts){
    // Pressure drives spawn rate and cap
    state.pressure = computePressure();
    const now = performance.now();

    // People Waiting counter drift (pressure-scaled)
    updatePeopleCounter(now, dt);

    // Spawn cadence (low pressure => slower, high => faster)
    const minI = 600, maxI = 4000; // ms
    const wait = maxI - (maxI - minI) * state.pressure;
    const softCap = Math.round(5 + state.pressure * 35); // legacy behavior
    const cfgCrowd = CONFIG.crowd || {};
    const useMatch = !!cfgCrowd.matchHud;
    const hudTarget = Math.min((state.peopleWaiting|0), cfgCrowd.maxOnScreen || 240);
    const target = useMatch ? hudTarget : softCap;
    const need = Math.max(0, target - state.agents.length);
    if (now >= (state.nextAgentAt || 0)){
      if (need > 0){
        const burst = Math.min(need, cfgCrowd.spawnBurst || 8);
        for (let i=0;i<burst;i++) spawnAgent();
        // When catching up, spawn rapidly; otherwise use pressure cadence
        const fast = cfgCrowd.minSpawnIntervalMs || 60;
        state.nextAgentAt = now + (useMatch ? Math.max(fast, wait*0.25) : wait);
      } else {
        // Nothing needed, check again later
        state.nextAgentAt = now + (useMatch ? Math.max(cfgCrowd.minSpawnIntervalMs||60, wait*0.5) : wait);
      }
    }
    // If we have more than target, trim oldest to match
    if (state.agents.length > target){
      state.agents.splice(0, state.agents.length - target);
    }

    // Update ambient voices pacing
    if (now >= (state._nextAmbientAt || 0)){
      const delay = 2500 - 2000*state.pressure; // 2.5s..0.5s
      triggerAmbientVoices();
      state._nextAmbientAt = now + Math.max(600, delay);
    }

    // Update each agent: repath occasionally, follow path, apply separation, bobbing
  const orbitMin = (cfgCrowd.orbitBand?.min ?? (cfgCrowd.playerStandoffRadius||84) + 8);
  const orbitMax = (cfgCrowd.orbitBand?.max ?? (cfgCrowd.playerStandoffRadius||84) + 36);
  // Cap speeds at high N
  const baseMaxSpd = 40 + state.pressure*30; // px/s
  const maxSpdCap = (cfgCrowd.highN && cfgCrowd.highN.maxSpeed) || 52;
  const maxSpd = Math.min(baseMaxSpd, (state.agents.length > (cfgCrowd.highN?.t1||80)) ? maxSpdCap : baseMaxSpd);
  const sepRadius = 22; // separation influence

    // Pairwise separation (cheap for small N)
    for (let i=0; i<state.agents.length; i++){
      const a = state.agents[i];
      // Establish a personal orbit target around the player to avoid blob
      if (a.orbitAng === undefined) a.orbitAng = Math.random()*Math.PI*2;
      if (a.orbitR === undefined) a.orbitR = orbitMin + Math.random()*(Math.max(10, orbitMax - orbitMin));
      // Add a tiny drift so they naturally distribute
      a.orbitAng += (Math.random()-0.5) * dt * 0.7;
      const goal = { x: state.player.x + Math.cos(a.orbitAng)*a.orbitR,
                     y: state.player.y + Math.sin(a.orbitAng)*a.orbitR };
      const gCell = worldToCell(goal.x, goal.y);
      // Repath if needed
      if (now >= (a.nextRepathAt||0) || a._lastGoalCell !== (gCell.cx<<16 | gCell.cy)){
        a.path = findPath(a.wx, a.wy, goal.x, goal.y);
        a.pi = 0;
        a._lastGoalCell = (gCell.cx<<16 | gCell.cy);
        // Repath less often at high population
        const hn = cfgCrowd.highN || {};
        const base = hn.repathBaseMs || 1400;
        const jitter = hn.repathJitterMs || 1400;
        let factor = 1.0;
        if (state.agents.length > (hn.t2||140)) factor = 2.2;
        else if (state.agents.length > (hn.t1||80)) factor = 1.6;
        a.nextRepathAt = now + (base*factor) + Math.random()*jitter;
      }
      // Follow path
      if (a.path && a.pi < a.path.length){
        const wp = a.path[a.pi];
        const dx = wp.x - a.wx; const dy = wp.y - a.wy;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist < Math.max(6, a.r*0.8)){
          a.pi++;
        } else {
          const spd = Math.min(maxSpd, a.speed);
          const step = spd * dt;
          let nx = a.wx + (dx/dist) * step;
          let ny = a.wy + (dy/dist) * step;
          // Stay in walkable
          if (!isWalkable(nx, ny)){
            // try axis projections
            if (isWalkable(a.wx + (dx/dist)*step, a.wy)) { nx = a.wx + (dx/dist)*step; ny = a.wy; }
            else if (isWalkable(a.wx, a.wy + (dy/dist)*step)) { nx = a.wx; ny = a.wy + (dy/dist)*step; }
            else { /* stuck */ }
          }
          a.wx = nx; a.wy = ny;
          a.flip = (dx < 0);
        }
      }
      // Bobbing
      a.bobT += dt * (0.8 + a.bobRate);
      a.yOff = Math.sin(a.bobT) * a.bobAmp;
      // Fade in
      if (a.alpha < a.maxAlpha){ a.alpha = Math.min(a.maxAlpha, a.alpha + dt*2); }
    }
  // Solid collision resolution (agents vs agents) — adapt iterations at high N
  const collidePad = 4; // increase padding so silhouettes maintain personal space
    let iters = 2;
    const hn = cfgCrowd.highN || {};
    if (state.agents.length > (hn.t2||140)) iters = hn.sep2 ?? 0;
    else if (state.agents.length > (hn.t1||80)) iters = hn.sep1 ?? 1;
    else iters = hn.sep0 ?? 2;
    for (let iter=0; iter<iters; iter++){
      for (let i=0;i<state.agents.length;i++){
        const a = state.agents[i];
        for (let j=i+1;j<state.agents.length;j++){
          const b = state.agents[j];
          let dx = b.wx - a.wx; let dy = b.wy - a.wy; let d2 = dx*dx + dy*dy;
          const minD = a.r + b.r + collidePad;
          if (d2 === 0){ dx = (Math.random()-0.5)*0.01; dy = (Math.random()-0.5)*0.01; d2 = dx*dx + dy*dy; }
          if (d2 < minD*minD){
            const d = Math.sqrt(d2);
            const overlap = (minD - d);
            const ux = dx / (d||1); const uy = dy / (d||1);
            const half = overlap * 0.5;
            // Move both apart equally
            const ax0=a.wx, ay0=a.wy, bx0=b.wx, by0=b.wy;
            a.wx -= ux * half; a.wy -= uy * half;
            b.wx += ux * half; b.wy += uy * half;
            // Keep roughly walkable by clamping back if necessary (cheap test)
            if (!isWalkable(a.wx, a.wy)){ a.wx=ax0; a.wy=ay0; }
            if (!isWalkable(b.wx, b.wy)){ b.wx=bx0; b.wy=by0; }
          }
        }
      }
    }

    // Agent vs player collision: push agents away from player circle
    const playerR = CONFIG.avatarRadius || 12;
    const standR = (cfgCrowd.playerStandoffRadius || 84);
    for (const a of state.agents){
      const dx = a.wx - state.player.x; const dy = a.wy - state.player.y;
      const d2 = dx*dx + dy*dy; const d = Math.sqrt(d2) || 0.001;
      const minD = a.r + playerR;
      // Hard push if intersecting the player's body circle
      if (d2 < minD*minD){
        const overlap = (minD - d);
        const ux = dx/d, uy = dy/d; const push = overlap; // move agent fully
        const ax0=a.wx, ay0=a.wy; a.wx += ux * push; a.wy += uy * push;
        if (!isWalkable(a.wx, a.wy)){ a.wx=ax0; a.wy=ay0; }
        if (!a._lastBumpAt || (now - a._lastBumpAt) > 2000){
          a._lastBumpAt = now;
          if (Math.random() < 0.5) speak(a, pickPhrase('bump'));
        }
      }
      // Soft standoff: gently push agents out of a larger radius around player
      else if (d < standR){
        const ux = dx/(d||1), uy = dy/(d||1);
        const overlap = (standR - d);
        const push = Math.min(6, overlap * 0.35); // gentle
        const ax0=a.wx, ay0=a.wy; a.wx += ux * push; a.wy += uy * push;
        if (!isWalkable(a.wx, a.wy)){ a.wx=ax0; a.wy=ay0; }
      }
    }
  }

  function spawnAgent(){
    // Choose a spawn near the Zone 1 right edge, on walkable
    const base1W = state.zone1W || (els.imgBase.naturalWidth||state.baseW*0.5);
    const minX = Math.max(4, base1W - 200);
    const maxX = Math.max(minX+10, base1W - 40);
    let tries = 40, wx = minX + Math.random()*(maxX-minX), wy = state.baseH*0.35 + Math.random()*state.baseH*0.4;
    while (tries-- > 0 && !isWalkable(wx, wy)){
      wx = minX + Math.random()*(maxX-minX);
      wy = state.baseH*0.2 + Math.random()*state.baseH*0.6;
    }
  const img = state.silImgs.length ? state.silImgs[Math.floor(Math.random()*state.silImgs.length)] : null;
  const hPx = 44 + Math.random()*18; // larger on-screen height to take more space
    const nH = img?.naturalHeight || hPx, nW = img?.naturalWidth || (hPx*0.5);
    const scale = nH ? (hPx / nH) : 1;
    const a = {
      id: state.agentIdSeq++,
      wx, wy,
      r: 12 + Math.random()*5, // larger radius increases separation
      speed: 30 + Math.random()*30,
      img,
      drawW: nW * scale,
      drawH: hPx,
      path: [], pi: 0, nextRepathAt: 0,
      flip: Math.random()<0.5,
      alpha: 0, maxAlpha: 0.5, // slightly lighter so large clusters don't go solid black
      bobT: Math.random()*Math.PI*2,
      bobAmp: 1 + Math.random()*2,
      bobRate: Math.random()*0.6,
    };
    state.agents.push(a);
  }

  function drawCrowdWorld(ctx, viewRect){
    if (!state.agents.length) return;
    // draw back-to-front by world Y for better layering
    const arr = state.agents.slice().sort((a,b)=>a.wy - b.wy);
    for (const a of arr){
      const s = worldToScreen(a.wx, a.wy);
      const x = s.x; const y = s.y + a.yOff;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, a.alpha));
      // Subtle ground shadow to separate silhouettes visually
      ctx.save();
      ctx.globalAlpha *= 0.25;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(x, y-2, (a.drawW*0.28), (a.drawH*0.12), 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      if (a.img){
        const dx = x - (a.drawW/2) * (a.flip ? -1 : 1);
        const dw = a.flip ? -a.drawW : a.drawW;
        const dy = y - a.drawH;
        ctx.drawImage(a.img, dx, dy, dw, a.drawH);
      } else {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(x, y - a.drawH*0.65, a.drawW*0.25, a.drawH*0.5, 0, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // NAVMESH GRID (coarse)
  function buildNavMesh(){
    const cell = 12; // px
    const w = Math.max(1, Math.floor((state.zone1W || state.baseW)*1.0 / cell));
    const h = Math.max(1, Math.floor((state.baseH) / cell));
    const walk = new Uint8Array(w*h);
    for (let gy=0; gy<h; gy++){
      for (let gx=0; gx<w; gx++){
        const wx = gx*cell + cell*0.5;
        const wy = gy*cell + cell*0.5;
        walk[gy*w + gx] = isWalkable(wx, wy) ? 1 : 0;
      }
    }
    state.nav = { gridW: w, gridH: h, cell, walk };
  }

  function worldToCell(wx, wy){
    const cell = state.nav.cell;
    return { cx: Math.max(0, Math.min(state.nav.gridW-1, Math.floor(wx / cell))),
             cy: Math.max(0, Math.min(state.nav.gridH-1, Math.floor(wy / cell))) };
  }
  function cellToWorld(cx, cy){
    const cell = state.nav.cell; return { x: cx*cell + cell*0.5, y: cy*cell + cell*0.5 };
  }

  function findPath(sx, sy, gx, gy){
    const nav = state.nav; if (!nav || !nav.walk) return [];
    const start = worldToCell(sx, sy); const goal = worldToCell(gx, gy);
    const W = nav.gridW, H = nav.gridH, walk = nav.walk;
    const startIdx = start.cy*W + start.cx; const goalIdx = goal.cy*W + goal.cx;
    if (!walk[startIdx] || !walk[goalIdx]) return [cellToWorld(goal.cx, goal.cy)];
    // A* with 8-neighbors
    const open = new MinHeap((a,b)=>a.f-b.f);
    const came = new Int32Array(W*H); came.fill(-1);
    const gscore = new Float32Array(W*H); gscore.fill(Infinity);
    const fscore = new Float32Array(W*H); fscore.fill(Infinity);
    gscore[startIdx] = 0; fscore[startIdx] = heuristic(start.cx, start.cy, goal.cx, goal.cy);
    open.push({ i: startIdx, f: fscore[startIdx] });
    const nbrs = [ [1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1] ];
    while(!open.isEmpty()){
      const cur = open.pop();
      const i = cur.i; if (i === goalIdx) break;
      const cx = i % W, cy = (i / W)|0;
      for (const [dx,dy] of nbrs){
        const nx = cx+dx, ny = cy+dy; if (nx<0||ny<0||nx>=W||ny>=H) continue;
        const ni = ny*W + nx; if (!walk[ni]) continue;
        const step = (dx===0||dy===0) ? 1 : 1.4142;
        const tentative = gscore[i] + step;
        if (tentative < gscore[ni]){
          came[ni] = i; gscore[ni] = tentative;
          fscore[ni] = tentative + heuristic(nx, ny, goal.cx, goal.cy);
          open.push({ i: ni, f: fscore[ni] });
        }
      }
    }
    // Reconstruct
    const path = [];
    let i = goalIdx; if (came[i] === -1) return [cellToWorld(goal.cx, goal.cy)];
    while (i !== -1){ const cx = i % W, cy = (i/W)|0; path.push(cellToWorld(cx, cy)); i = came[i]; }
    path.reverse();
    // Optional: thin path by skipping nearly collinear points
    return path;
    function heuristic(ax,ay,bx,by){ const dx=Math.abs(ax-bx), dy=Math.abs(ay-by); return dx+dy + (Math.SQRT2-2)*Math.min(dx,dy); }
  }

  // Simple binary heap for A*
  class MinHeap{
    constructor(cmp){ this._arr=[]; this._cmp=cmp; }
    push(x){ this._arr.push(x); this._siftUp(this._arr.length-1); }
    pop(){ const a=this._arr; if (a.length===1) return a.pop(); const top=a[0]; a[0]=a.pop(); this._siftDown(0); return top; }
    isEmpty(){ return this._arr.length===0; }
    _siftUp(i){ const a=this._arr, cmp=this._cmp; while(i>0){ const p=(i-1)>>1; if (cmp(a[i],a[p])<0){ [a[i],a[p]]=[a[p],a[i]]; i=p; } else break; } }
    _siftDown(i){ const a=this._arr, cmp=this._cmp; for(;;){ let l=i*2+1, r=l+1, s=i; if (l<a.length && cmp(a[l],a[s])<0) s=l; if (r<a.length && cmp(a[r],a[s])<0) s=r; if (s!==i){ [a[i],a[s]]=[a[s],a[i]]; i=s; } else break; } }
  }

  // VOICES
  const PHRASES = {
    ambient: ["It’s getting crowded.", "Any news?", "Still waiting.", "Hope they hurry up.", "Long day…"],
    bump: ["Whoa—sorry.", "Excuse me.", "Careful!", "Watch it."],
    positive: ["Finally some movement.", "Good—materials are moving.", "That helps.", "Nice work."],
    tense: ["We can’t wait forever.", "Pressure’s building.", "More coming in.", "Tick tock."],
    heavy: [
      "I’ve been on a list for months—rent doubled overnight.",
      "My kids are sleeping in the car. This isn’t living.",
      "We’re priced out of our own neighborhood.",
      "Every hour we wait costs us—jobs, school, dignity.",
      "Shelters are full. We need homes, not promises.",
      "Winter’s coming and we’re still outside.",
      "Two jobs and I still can’t afford a room.",
      "Where are we supposed to go?"
    ]
  };

  function pickPhrase(kind){
    const arr = PHRASES[kind] || PHRASES.ambient; return arr[(Math.random()*arr.length)|0];
  }

  function speak(agent, text, tone){
    if (!text) text = pickPhrase('ambient');
    // Attach bubble to this agent’s head (dynamic tracking)
    speakAt(text, agent.wx, agent.wy, tone, { agentId: agent.id, anchor: 'head' });
  }
  function speakAt(text, wx, wy, tone='neutral', opts={}){
    if (!els.voices) return;
    const el = document.createElement('div');
    el.className = `voice ${tone}`;
    // Minimal inline styles to be self-contained
    el.style.position = 'absolute'; el.style.transform = 'translate(-50%, -100%)';
    // Stage 1 — classic bubble visuals during active phase
    const bg = tone==='good' ? 'rgba(60,180,90,.9)'
                        : tone==='warn' ? 'rgba(220,80,60,.9)'
                        : tone==='heavy' ? 'rgba(160,30,30,.92)'
                        : 'rgba(0,0,0,.70)';
    el.style.background = bg; try{ el.style.setProperty('--bg', bg); }catch{}
    el.style.color = '#fff';
    // Scale modulation by length (bigger for short shouts)
    const len = (text||'').length;
    const fsz = len <= 18 ? 16 : len <= 42 ? 13 : 12;
    el.style.font = `${tone==='heavy'?700:600} ${fsz}px system-ui,Segoe UI,Arial`;
    if (tone==='heavy'){ el.style.letterSpacing = '.2px'; }
    el.style.padding = '4px 6px';
    el.style.borderRadius = '6px';
    el.style.pointerEvents='none'; el.style.whiteSpace='nowrap';
    el.style.filter='drop-shadow(0 1px 2px rgba(0,0,0,.4))';
    // Quick fade-in
    el.style.opacity = '0';
    el.style.transition = 'opacity .18s ease-out';
    el.textContent = text;
    els.voices.appendChild(el);
    const until = performance.now() + 2600 + Math.random()*1200;
    // Cap bubbles to avoid flood
    if (state.voiceBubbles.length > 30){
      try { const old = state.voiceBubbles.shift(); old?.el?.remove?.(); } catch{}
    }
    // Active shout window before residue (2–4s)
    const activeFor = 2000 + Math.random()*2000;
    const activeUntil = performance.now() + activeFor;
    const vb = { wx, wy, text, el, until, tone, activeUntil, hasStamped:false };
    if (opts && opts.agentId){ vb.agentId = opts.agentId; vb.anchor = opts.anchor || 'head'; }
    state.voiceBubbles.push(vb);
  }

  function updateVoices(){
    const now = performance.now();
    const keep = [];
    for (const vb of state.voiceBubbles){
      if (now >= vb.until){ try{ vb.el.remove(); }catch{} continue; }
      // Stage 1 — Active: slight jitter before residue stamping
      let jitterX = 0, jitterY = 0;
      if (now < (vb.activeUntil||0)){
        jitterX = (Math.random()-0.5)*8; // ±4px
        jitterY = (Math.random()-0.5)*6; // ±3px
      } else if (!vb.hasStamped){
        // Stage 2 — Create residue once per bubble, then fade bubble quickly
        try{ stampResidueFromBubble(vb); vb.hasStamped = true; }catch{}
        try { vb.el.style.opacity = '0.25'; } catch{}
        vb.until = Math.min(vb.until, now + 600);
      }

      if (vb.agentId){
        const a = state.agents.find(x=>x.id===vb.agentId);
        if (a){
          const s = worldToScreen(a.wx, a.wy);
          const headOffset = (a.drawH || 36); // pixels in screen space
          vb.el.style.left = `${s.x + jitterX}px`; vb.el.style.top = `${s.y - headOffset - 8 + jitterY}px`;
        } else {
          // Agent despawned; quickly retire this bubble
          vb.until = Math.min(vb.until, now + 400);
          const s = worldToScreen(vb.wx, vb.wy);
          vb.el.style.left = `${s.x + jitterX}px`; vb.el.style.top = `${s.y + jitterY}px`;
        }
      } else {
        const s = worldToScreen(vb.wx, vb.wy);
        vb.el.style.left = `${s.x + jitterX}px`; vb.el.style.top = `${s.y + jitterY}px`;
      }
      keep.push(vb);
    }
    state.voiceBubbles = keep;

    // Aging pass (Stage 4 — Weathering) occasionally to slightly grey/flatten
    try{
      if (state.residueCtx && (now - state._lastResidueAgeAt) > 10000){
        state._lastResidueAgeAt = now;
        state.residueCtx.save();
        state.residueCtx.globalCompositeOperation = 'source-over';
        state.residueCtx.fillStyle = 'rgba(110,110,110,0.005)';
        state.residueCtx.fillRect(0,0,state.baseW,state.baseH);
        state.residueCtx.restore();
      }
    }catch{}

    // Slowly relax the residueScore when pressure is low (recovery)
    if (state.residueScore > 0 && state.pressure < 0.25){
      state.residueScore = Math.max(0, state.residueScore - 0.0015);
    }
  }

  // Stamp residue text into the world-anchored residue canvas
  function stampResidueFromBubble(vb){
    if (!state.residueCtx) return;
    // Choose world coordinates for stamping (use agent if available)
    let wx = vb.wx, wy = vb.wy;
    if (vb.agentId){
      const a = state.agents.find(x=>x.id===vb.agentId);
      if (a){ wx = a.wx; wy = a.wy - Math.max(18, (a.drawH||36)*0.6); }
    }
    // Tone/color mapping: heavy/warn => deep red; neutral => grey; good => off-white
    const color = (vb.tone==='heavy'||vb.tone==='warn') ? '#cc0000' : (vb.tone==='good' ? '#e8e8e8' : '#c7c7c7');
    // Scale modulation: shorter text -> larger
    const len = (vb.text||'').length;
    const basePx = len <= 22 ? 24 : len <= 48 ? 18 : 14;
    // Pressure influences opacity a bit
    const alpha = 0.18 + state.pressure*0.22; // ~0.18..0.40
    const ctx = state.residueCtx;
    ctx.save();
    ctx.globalAlpha = Math.max(0.06, Math.min(0.6, alpha));
    ctx.fillStyle = color;
    ctx.font = `700 ${basePx}px system-ui,Segoe UI,Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // Slight drift prior to sticking
    const driftX = (Math.random()-0.5)*10; // ±5px
    const driftY = (Math.random()-0.5)*8; // ±4px
    ctx.fillText(vb.text, wx + driftX, wy + driftY);
    ctx.restore();
    // Build up residue score for saturation effect
    state.residueScore = Math.min(1, state.residueScore + Math.min(0.05, (basePx/48)*0.03 + len*0.0004));
  }

  function burstVoicesNear(wx, wy, count=2, kind='ambient'){
    // Find nearest agents in radius and make them speak
    const arr = state.agents.map(a=>({ a, d: Math.hypot(a.wx - wx, a.wy - wy) })).sort((u,v)=>u.d - v.d);
    for (let i=0;i<Math.min(count, arr.length); i++){
      const {a} = arr[i];
      const tone = kind==='positive' ? 'good' : kind==='tense' ? 'warn' : kind==='heavy' ? 'heavy' : 'neutral';
      speak(a, pickPhrase(kind==='heavy'?'heavy':kind), tone);
    }
  }

  function forceHeavyBurst(){
    const wx = state.player.x, wy = state.player.y;
    // Heavy lines from nearby agents (not the player)
    burstVoicesNear(wx, wy, 4, 'heavy');
    speakNearestAgent("We need homes. Not later—now.", wx, wy, 'heavy');
  }

  function triggerAmbientVoices(){
    if (!state.agents.length) return;
    const now = performance.now();
    const sinceShipment = (now - (state.lastShipmentAt||0)) / 1000; // seconds
    const manyWaiting = (state.peopleWaiting || 0) >= 10; // lowered threshold
    const veryHighPressure = state.pressure > 0.6; // lowered threshold
    const highPressure = state.pressure > 0.5;
    const arrivalSoon = (state.nextArrivalAt ? (state.nextArrivalAt - now) <= 10000 : false);

    // Base chatter probability per agent (low)
  const baseP = 0.15 + state.pressure*0.65; // 0.15..0.80

    for (const a of state.agents){
      // Heavy crisis lines when pressure is very high AND we’ve been waiting a while or many are queued
      if (((veryHighPressure && (sinceShipment > 12 || manyWaiting)) || arrivalSoon) && (now - state._lastHeavyAt > 1200)){
        // Higher chance if arrival is imminent or queue is long
        const heavyP = arrivalSoon ? 0.16 : manyWaiting ? 0.12 : 0.08;
        if (Math.random() < heavyP){
          state._lastHeavyAt = now;
          speak(a, pickPhrase('heavy'), 'heavy');
          continue;
        }
      }
      // Tense lines when pressure is high
      if (Math.random() < baseP*0.05){
        const tone = highPressure ? 'warn' : 'neutral';
        const kind = highPressure ? 'tense' : 'ambient';
        speak(a, pickPhrase(kind), tone);
      }
    }

    // Milestone bursts when People Waiting crosses thresholds
    try {
      const pw = state.peopleWaiting|0;
      const milestone = pw >= 100 ? 100 : pw >= 50 ? 50 : pw >= 25 ? 25 : pw >= 10 ? 10 : 0;
      if (milestone && state._heavyMilestone < milestone){
        state._heavyMilestone = milestone;
        // Burst near player location but spoken by nearby agents
        const wx = state.player.x, wy = state.player.y;
        burstVoicesNear(wx, wy, 3, 'tense');
        speakNearestAgent("We need homes. Not later—now.", wx, wy, 'heavy');
      }
    } catch{}
  }

  function speakNearestAgent(text, wx, wy, tone='neutral'){
    if (!state.agents.length) return;
    let best = null; let bestD = Infinity;
    for (const a of state.agents){
      const d = Math.hypot(a.wx - wx, a.wy - wy);
      if (d < bestD){ bestD = d; best = a; }
    }
    if (best) speak(best, text, tone);
  }

  // PEOPLE COUNTER
  function adjustPeopleWaiting(delta, opts={}){
    state.peopleWaiting = Math.max(0, state.peopleWaiting + delta);
    try { if (els.hudPeople) els.hudPeople.textContent = state.peopleWaiting|0; } catch{}
  }
  function updatePeopleCounter(now, dt){
    if (!state._nextPeopleTickAt) state._nextPeopleTickAt = now;
    const rate = 0.05 + state.pressure * 2.2; // people per second
    state._peopleAcc += rate * dt;
    if (state._peopleAcc >= 1){ const inc = Math.floor(state._peopleAcc); state._peopleAcc -= inc; adjustPeopleWaiting(inc); }
  }

  // Detect if avatar is near top-left or top-right inside the active panel to change zones
  function checkZoneDoors(ts){
    const margin = CONFIG.doorMargin;
    if (!state.view || !state.view.w) return;
    const s = worldToScreen(state.player.x, state.player.y);
    const left = state.view.x;
    const top = state.view.y;
    const right = state.view.x + state.view.w;

    const nearTop = s.y <= top + margin;
    const cooldownOk = (ts - state.lastDoorSwitchTs) >= CONFIG.doorCooldownMs;
    if (!nearTop || !cooldownOk) return;

    if (s.x <= left + margin) {
      // top-left door → previous zone
      switchZoneByDoor(-1, ts);
    } else if (s.x >= right - margin) {
      // top-right door → next zone
      switchZoneByDoor(1, ts);
    }
  }

  function switchZoneByDoor(dir, ts){
    const next = state.activeZone + dir;
    if (next < 0 || next >= state.zones.length) {
      toast(dir < 0 ? 'No previous zone' : 'No next zone', 'warn');
      state.lastDoorSwitchTs = ts;
      return;
    }
    state.activeZone = next;
    state.lastDoorSwitchTs = ts;
    toast(`Entering ${state.zones[state.activeZone].name}`, 'ok');
  }

  /* ---------------------- PLAYER & CAMERA ------------------------ */
  function updatePlayer(dt) {
    // Pause player control while any modal overlay is active
    const overlayActive = (els.ovHelp?.getAttribute('aria-hidden') === 'false') ||
                          (els.ovCut?.getAttribute('aria-hidden') === 'false') ||
                          (els.ovBolt?.getAttribute('aria-hidden') === 'false');
    if (overlayActive) { state.player.moving = false; return; }
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

    // Clamp to world boundaries first
    nx = Math.max(0, Math.min(state.baseW - 1, nx));
    ny = Math.max(0, Math.min(state.baseH - 1, ny));

    // Check walkability (can bypass with debug flag)
    if (state.debugIgnoreMask || isWalkable(nx, ny)) {
      state.player.x = nx; 
      state.player.y = ny;
      state.player.moving = (vx !== 0 || vy !== 0);
    } else {
      // Try X-only movement if diagonal movement is blocked
      if (vx !== 0 && (state.debugIgnoreMask || isWalkable(state.player.x + vx * speed * dt, state.player.y))) {
        state.player.x = Math.max(0, Math.min(state.baseW - 1, state.player.x + vx * speed * dt));
        state.player.moving = true;
      }
      // Try Y-only movement if diagonal movement is blocked  
      else if (vy !== 0 && (state.debugIgnoreMask || isWalkable(state.player.x, state.player.y + vy * speed * dt))) {
        state.player.y = Math.max(0, Math.min(state.baseH - 1, state.player.y + vy * speed * dt));
        state.player.moving = true;
      } else {
        state.player.moving = false;
      }
    }

    // Near a hotspot? update HUD hint
    const hs = getNearestHotspotWithin(CONFIG.hotspotProximity);
    if (hs) {
      const name = hs.type === 'cut' ? 'Precision Cutting' : (hs.type === 'hold' ? 'Hold the Frame' : 'Sequential Torque');
      els.hudMsg.textContent = `${name} — Press E to start.`;
    } else {
      els.hudMsg.textContent = 'Walk to a highlighted part to begin.';
    }
  }

  function isWalkable(wx, wy) {
    const x = Math.round(wx), y = Math.round(wy);
    if (x<0||y<0||x>=state.baseW||y>=state.baseH) return false;
    // Allow free walking in regions beyond the Zone 1 mask (e.g., stitched Zone 2)
    const mw = state.maskCanvas.width, mh = state.maskCanvas.height;
    if (x >= mw || y >= mh) return true;
    const d = state.maskCtx.getImageData(x, y, 1, 1).data;
    const cls = classifyPixel(d[0], d[1], d[2]);
    if (state.walkableMode === 'blue') {
      return cls === 'blue';
    }
    // luminance fallback: block red/yellow, allow bright areas
    if (cls === 'red' || cls === 'yellow') return false;
    const lum = 0.2126*d[0] + 0.7152*d[1] + 0.0722*d[2];
    return lum >= state.walkLumThreshold;
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

    // Auto-select active zone based on player X when enabled
    if (state.autoZone && state.zones.length > 0) {
      const zoneWidth = state.baseW / state.zones.length;
      const z = Math.max(0, Math.min(state.zones.length-1, Math.floor(state.player.x / zoneWidth)));
      state.activeZone = z;
    }
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

    // --- Layout: either full-bleed or carousel panel ---
    const useFullBleed = (CONFIG.fullBleedZones || []).includes(state.activeZone);
    const layout = useFullBleed ? drawFullBleedLayout(ctx) : drawCarouselBackdrop(ctx);
    // Update view transform for world->screen mapping (center panel)
    state.view.x = layout.center.x;
    state.view.y = layout.center.y;
    state.view.w = layout.center.w;
    state.view.h = layout.center.h;
    const vw = els.world.clientWidth;
    const vh = els.world.clientHeight;
    state.view.scale = state.view.w / vw; // aspect preserved, so same for H

    // Clip base image into the center panel so it reads like a slideshow
    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.center.x, layout.center.y, layout.center.w, layout.center.h);
    ctx.clip();
    // Draw stitched base imagery: Zone 1 at x=0, Zone 2 at x=base1W
    const base1W = els.imgBase.naturalWidth || 0;
    const base1H = els.imgBase.naturalHeight || 0;
    const base2W = (els.imgBase2 && els.imgBase2.naturalWidth) ? els.imgBase2.naturalWidth : 0;
    const base2H = (els.imgBase2 && els.imgBase2.naturalHeight) ? els.imgBase2.naturalHeight : 0;

    // Helper to draw one intersection
    function drawIntersection(img, imgBoundsX, imgBoundsY, imgW, imgH){
      // World window
      const camX = state.cam.x, camY = state.cam.y;
      const ww = vw, wh = vh;
      // Intersection in world space
      const ix = Math.max(camX, imgBoundsX);
      const iy = Math.max(camY, imgBoundsY);
      const ix2 = Math.min(camX + ww, imgBoundsX + imgW);
      const iy2 = Math.min(camY + wh, imgBoundsY + imgH);
      const iw = ix2 - ix; const ih = iy2 - iy;
      if (iw <= 0 || ih <= 0) return; // no overlap

      // Source in image space
      const sx = ix - imgBoundsX;
      const sy = iy - imgBoundsY;
      const sw = iw;
      const sh = ih;

      // Dest in panel space
      const relX = (ix - camX) / ww; // 0..1 across panel
      const relY = (iy - camY) / wh;
      const relW = iw / ww;
      const relH = ih / wh;
      const dx = layout.center.x + relX * layout.center.w;
      const dy = layout.center.y + relY * layout.center.h;
      const dw = relW * layout.center.w;
      const dh = relH * layout.center.h;

      ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    }

    // Draw Zone 1 intersection
    drawIntersection(els.imgBase, 0, 0, base1W, base1H);
    // Draw Zone 2 intersection if present
    if (base2W > 0){
      drawIntersection(els.imgBase2, base1W, 0, base2W, base2H || base1H);
    }
    // Render red/grey overlays for dismantle areas from the mask islands
    drawIslandOverlays(ctx, layout.center);
    // Logistics draw on top of world
    drawLogistics(ctx, layout.center);
    // Plane arrival overlays (above base, below avatar/UI)
    drawPlaneOverlays(ctx, layout.center);
    // Visual Residue — accumulate voices as multiply layer mapped to world
    if (state.residueCan) {
      const vw = els.world.clientWidth;
      const vh = els.world.clientHeight;
      const camX = state.cam.x, camY = state.cam.y;
      const bx = 0, by = 0, bw = state.baseW, bh = state.baseH;
      const ix = Math.max(camX, bx);
      const iy = Math.max(camY, by);
      const ix2 = Math.min(camX + vw, bx + bw);
      const iy2 = Math.min(camY + vh, by + bh);
      const iw = ix2 - ix, ih = iy2 - iy;
      if (iw > 0 && ih > 0) {
        const relX = (ix - camX) / vw;
        const relY = (iy - camY) / vh;
        const relW = iw / vw;
        const relH = ih / vh;
        const dx = layout.center.x + relX * layout.center.w;
        const dy = layout.center.y + relY * layout.center.h;
        const dw = relW * layout.center.w;
        const dh = relH * layout.center.h;
        const sx = ix - bx;
        const sy = iy - by;
        const sw = iw;
        const sh = ih;
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(state.residueCan, sx, sy, sw, sh, dx, dy, dw, dh);
        ctx.restore();
      }
    }
    // Crowd (world-anchored) above overlays and logistics, below player/UI
    drawCrowdWorld(ctx, layout.center);
    // Background tinting disabled: keep original artwork colors with no red wash
    ctx.restore();

    // Optional: debug show hotspots centers
    // ctx.fillStyle = 'rgba(255,0,0,.5)';
    // for (const hs of state.hotspots) {
    //   if (hs.completed) continue;
    //   const s = worldToScreen(hs.cx, hs.cy);
    //   ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI*2); ctx.fill();
    // }

    // Player sprite is drawn via DOM (avatarEl) — remove debug dot

    // Draw faint boundary line between Zone 1 and Zone 2
    if (state.zoneBoundaryX > 0){
      const top = worldToScreen(state.zoneBoundaryX, 0);
      const bot = worldToScreen(state.zoneBoundaryX, state.baseH);
      ctx.save();
      ctx.strokeStyle = CONFIG.truck.boundaryLineColor;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
      ctx.restore();
    }
  }

  /* ----------------- PLANE OVERLAY ARRIVAL SYSTEM ---------------- */
  function updatePlaneArrivals(dt, nowMs){
    // Countdown and cues
    const now = nowMs || performance.now();
    // Pause window after clearing
    if (state.planeClearedUntil && now < state.planeClearedUntil){
      // hold timer; hum removed
      state.humGain = 0; try{ stopHum && stopHum(); }catch{}
      setHudArrival(Math.ceil((state.nextArrivalAt - now)/1000));
      return;
    }

    const sLeft = Math.max(0, Math.ceil((state.nextArrivalAt - now)/1000));
    setHudArrival(sLeft);
  // Hum removed per request
  state.humGain = 0; try{ stopHum && stopHum(); }catch{}

    if (now >= state.nextArrivalAt){
      enqueuePlaneOverlay();
      state.nextArrivalAt = now + state.planeTimerMs; // reset timer
    }
  }

  function setHudArrival(sec){
    try{
      if (!Number.isFinite(sec)) return;
      const mm = String(Math.floor(sec/60)).padStart(2,'0');
      const ss = String(sec%60).padStart(2,'0');
      els.hudMsg.textContent = `NEXT ARRIVAL — ${mm}:${ss}`;
    }catch{}
  }

  function enqueuePlaneOverlay(){
    if (!state.planeImgs.length) return;
    // pick next image cyclically
    const idx = state.overlays.length % state.planeImgs.length;
    const img = state.planeImgs[idx];
    // small imperfect offset
    const xOff = (state.overlays.length % 2 === 0) ? 2 : 4;
    const yOff = (state.overlays.length % 3) - 1; // -1,0,1
    state.overlays.push({ img, alpha: 0, xOff, yOff, greyed: false, t0: performance.now() });
    // soften oldest if >3
    if (state.overlays.length > 3){
      const oldest = state.overlays[0];
      oldest.alpha = Math.min(oldest.alpha, 0.15);
    }
  }

  function drawPlaneOverlays(ctx, viewRect){
    if (!CONFIG.planeOverlays?.enabled) return;
    if (!state.overlays.length) return;
    const vw = els.world.clientWidth;
    const vh = els.world.clientHeight;
    const camX = state.cam.x, camY = state.cam.y;
    const base1W = els.imgBase.naturalWidth || vw;
    const base1H = els.imgBase.naturalHeight || vh;

    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i=0;i<state.overlays.length;i++){
      const o = state.overlays[i];
      const t = Math.min(1, (performance.now() - (o.t0||0))/1000); // 1s fade in
      const target = o.greyed ? 0.18 : (i===0 && state.overlays.length>3 ? 0.15 : 0.78);
      o.alpha += (target - o.alpha) * 0.2;
      const alpha = Math.min(o.alpha, target) * t;
      if (alpha <= 0.01) continue;
      ctx.globalAlpha = alpha;

      const imgW = o.img.naturalWidth || base1W;
      const imgH = o.img.naturalHeight || base1H;
      // Scale so overlay height matches Zone 1 base height in world space
      const sH = base1H / imgH;
      const worldW = imgW * sH;
      const worldH = base1H;
      const bx = 0 + (o.xOff||0);
      const by = 0 + (o.yOff||0);

      // Intersection of overlay rect with camera window (world space)
      const ix = Math.max(camX, bx);
      const iy = Math.max(camY, by);
      const ix2 = Math.min(camX + vw, bx + worldW);
      const iy2 = Math.min(camY + vh, by + worldH);
      const iw = ix2 - ix, ih = iy2 - iy;
      if (iw <= 0 || ih <= 0) continue;

      // Source rect in image space
      const sx = (ix - bx) / sH;
      const sy = (iy - by) / sH;
      const sw = iw / sH;
      const sh = ih / sH;

      // Destination rect in panel space
      const relX = (ix - camX) / vw;
      const relY = (iy - camY) / vh;
      const relW = iw / vw;
      const relH = ih / vh;
      const dx = viewRect.x + relX * viewRect.w;
      const dy = viewRect.y + relY * viewRect.h;
      const dw = relW * viewRect.w;
      const dh = relH * viewRect.h;

      ctx.drawImage(o.img, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    ctx.restore();

    // Left-edge flicker anchored to world x=0
    const now = performance.now();
    if ((state.nextArrivalAt - now) <= 10000){
      const bx = 0, by = 0, bw = 40, bh = base1H;
      const ix = Math.max(state.cam.x, bx);
      const iy = Math.max(state.cam.y, by);
      const ix2 = Math.min(state.cam.x + vw, bx + bw);
      const iy2 = Math.min(state.cam.y + vh, by + bh);
      const iw = ix2 - ix, ih = iy2 - iy;
      if (iw > 0 && ih > 0){
        const relX = (ix - state.cam.x) / vw;
        const relY = (iy - state.cam.y) / vh;
        const relW = iw / vw;
        const relH = ih / vh;
        const dx = viewRect.x + relX * viewRect.w;
        const dy = viewRect.y + relY * viewRect.h;
        const dw = relW * viewRect.w;
        const dh = relH * viewRect.h;
        const k = 0.4 + 0.6*Math.sin(now/120);
        ctx.save();
        ctx.globalAlpha = 0.04 * k;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(dx, dy, dw, dh);
        ctx.restore();
      }
    }
  }

  function planeCleared(){
    // Turn existing overlays into faint grey and pause arrivals 5s
    for (const o of state.overlays){ o.greyed = true; }
    state.planeClearedUntil = performance.now() + state.planeClearedPauseMs;
    state.nextArrivalAt = state.planeClearedUntil + state.planeTimerMs; // resume after pause
    try {
      const dec = Math.min(state.peopleWaiting, 6);
      if (dec > 0){ adjustPeopleWaiting(-dec, { reason: 'planeCleared' }); speakAt(`−${dec} released`, 20, state.baseH*0.5, 'good'); }
      burstVoicesNear(state.player.x, state.player.y, 2, 'positive');
      // Remove a couple of nearest agents as if they left
      const arr = state.agents.map(a=>({ a, d: Math.hypot(a.wx - state.player.x, a.wy - state.player.y) })).sort((u,v)=>u.d - v.d);
      const removeN = Math.min(3, arr.length);
      const ids = new Set(arr.slice(0, removeN).map(o=>o.a.id));
      state.agents = state.agents.filter(a=>!ids.has(a.id));
    } catch{}
  }

  // Full-bleed layout: center rect spans the entire viewport; no panels or labels drawn
  function drawFullBleedLayout(ctx){
    const vw = els.world.clientWidth;
    const vh = els.world.clientHeight;
    return { center: { x: 0, y: 0, w: vw, h: vh } };
  }

  // Draw pre-rendered overlays for each red island; completed ones are grey
  function drawIslandOverlays(ctx, viewRect){
    const { x:rx, y:ry } = viewRect;
    const scale = state.view.scale || 1;
    for (const hs of state.hotspots){
      const ovA = hs.overlayActive, ovD = hs.overlayDone;
      if (!ovA && !ovD) continue;
      const bx = (hs.bbox.minx - state.cam.x) * scale + rx;
      const by = (hs.bbox.miny - state.cam.y) * scale + ry;
      const bw = (ovA||ovD).width * scale;
      const bh = (ovA||ovD).height * scale;

      let aAlpha = hs.completed ? 0 : 1;
      let dAlpha = hs.completed ? 1 : 0;
      let k = 0;
      if (hs.fadeEndTs && hs.fadeEndTs > 0){
        const now = performance.now();
        const dur = hs.fadeDur || CONFIG.overlayFadeMs;
        const start = hs.fadeStartTs || (hs.fadeEndTs - dur);
        k = Math.max(0, Math.min(1, (now - start)/dur));
        const e = easeInOutCubic(k);
        aAlpha = 1 - e;
        dAlpha = e;
        if (now >= hs.fadeEndTs) { hs.fadeEndTs = 0; }
      }

      if (ovA && aAlpha > 0) { ctx.save(); ctx.globalAlpha = aAlpha; ctx.drawImage(ovA, bx, by, bw, bh); ctx.restore(); }
      if (ovD && dAlpha > 0) { ctx.save(); ctx.globalAlpha = dAlpha; ctx.drawImage(ovD, bx, by, bw, bh); ctx.restore(); }

      // Shimmer stripe + thin cut line during the transition (left→right)
      if ((hs.fadeEndTs && hs.fadeEndTs > 0) && CONFIG.shimmer.enabled && ovA){
        try{
          const ovW = (ovA||ovD).width, ovH = (ovA||ovD).height;
          const stripeW = Math.max(6, ovW * CONFIG.shimmer.widthFrac);
          const pos = (k * (ovW + stripeW)) - stripeW/2; // center of stripe

          const off = document.createElement('canvas');
          off.width = ovW; off.height = ovH;
          const octx = off.getContext('2d');

          // Gradient stripe
          const g = octx.createLinearGradient(pos - stripeW/2, 0, pos + stripeW/2, 0);
          g.addColorStop(0.0, 'rgba(255,255,255,0)');
          g.addColorStop(0.5, `rgba(255,255,255,${CONFIG.shimmer.alpha})`);
          g.addColorStop(1.0, 'rgba(255,255,255,0)');
          octx.fillStyle = g;
          octx.fillRect(0, 0, ovW, ovH);

          // Thin cut line at stripe center
          octx.fillStyle = `rgba(255,255,255,${CONFIG.shimmer.lineAlpha})`;
          octx.fillRect(Math.max(0,pos-0.5), 0, 1, ovH);

          // Mask to island shape (use active overlay alpha)
          octx.globalCompositeOperation = 'destination-in';
          octx.drawImage(ovA, 0, 0);

          // Draw onto main canvas inside the panel, additive
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(off, bx, by, bw, bh);
          ctx.restore();
        }catch{}
      }
    }
  }

  // Carousel: overlapping panels with the active one centered and scaled up
  function drawCarouselBackdrop(ctx){
    const vw = els.world.clientWidth;
    const vh = els.world.clientHeight;

    // Colors roughly matching your mock
  const pale = '#f4dfa9';
  const mid  = '#e68f47';
  const hot  = '#e5533f';

    // Keep aspect of the world (vw:vh) in the center rect so our mapping is uniform
    const aspect = vw / vh;
    const maxW = vw * 0.66;
    const maxH = vh * 0.80;
    let centerW = maxW;
    let centerH = centerW / aspect;
    if (centerH > maxH) { centerH = maxH; centerW = centerH * aspect; }

  const h       = centerH;
  const cx      = vw*0.5;
  const cy      = vh*0.46;
  const centerX = cx - centerW/2;
  const centerY = cy - h/2;

    ctx.save();
  ctx.globalAlpha = 1;

    // Compute rects for visible items around the interpolated position
  const maxSide = CONFIG.carouselMaxVisible;
    const pos = state.carouselPos;
    const items = [];
  const baseSpacing = centerW * 0.68; // increased spacing for larger center

    const count = state.zones.length;
    for (let i = 0; i < count; i++) {
      const delta = i - pos; // negative => left, positive => right
      const ad = Math.abs(delta);
      if (ad > maxSide + 1) continue; // cull far items

      const scale = Math.max(
        CONFIG.carouselMinScale,
        CONFIG.carouselCenterScale - CONFIG.carouselScaleFalloff * ad
      );
      const alpha = Math.max(0.35, 1 - CONFIG.carouselAlphaFalloff * ad);
      const w = centerW * scale;
      const hh = h * scale;
      const x = cx - w/2 + delta * baseSpacing; // horizontal offset
      const y = cy - hh/2 + (ad>0 ? 6 : 0); // slight drop for non-active for depth
      const isCenter = ad < 0.5; // closest to center
      const color = isCenter ? hot : (ad < 1.5 ? mid : pale);
      items.push({ i, delta, ad, scale, alpha, x, y, w, h: hh, isCenter, color });
    }

    // Draw in order of increasing scale (back first), then increasing delta to stabilize order
    items.sort((a,b)=> (a.scale - b.scale) || (Math.abs(a.delta) - Math.abs(b.delta)));
    let centerRect = { x:centerX, y:centerY, w:centerW, h };
    for (const it of items) {
      ctx.save();
      ctx.globalAlpha = it.alpha;
      ctx.shadowColor = 'rgba(0,0,0,.18)';
      ctx.shadowBlur = it.isCenter ? 28 : 18;
      ctx.shadowOffsetY = it.isCenter ? 10 : 8;
      drawPanel(ctx, it.x, it.y + it.h/2, it.w, it.h, it.color);
      ctx.restore();
      if (it.isCenter) centerRect = { x: it.x, y: it.y, w: it.w, h: it.h };
    }

    // Labels
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  const titleSize = Math.round(Math.min(48, centerRect.h*0.08));
    ctx.font = `700 ${titleSize}px system-ui,Segoe UI,Arial`;
    const label = state.zones[state.activeZone]?.name || 'ACTIVE ZONE';
  ctx.fillText(label, cx, cy);

    const activeIdx = Math.round(pos);
    const prev = state.zones[activeIdx-1]?.name || '';
    const next = state.zones[activeIdx+1]?.name || '';
    if (prev) {
      ctx.font = `600 ${Math.round(titleSize*0.66)}px system-ui,Segoe UI,Arial`;
      ctx.fillText(prev, cx - baseSpacing*0.9, cy);
    }
    if (next) {
      ctx.font = `600 ${Math.round(titleSize*0.66)}px system-ui,Segoe UI,Arial`;
      ctx.fillText(next, cx + baseSpacing*0.9, cy);
    }

    ctx.restore();

    return {
      center: centerRect,
    };
  }

  function drawPanel(ctx, x, cy, w, h, color, yOffset=0){
    const y = cy - h/2 + yOffset;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function positionDecor() {
    // Avatar position
    const a = worldToScreen(state.player.x, state.player.y);
    avatarEl.style.left = `${a.x}px`;
    avatarEl.style.top = `${a.y}px`;
    avatarEl.style.display = 'block'; // Ensure visible

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
    // Map world coords (relative to camera) into the center panel rect using scale
    const sx = (wx - state.cam.x) * (state.view.scale || 1) + (state.view.x || 0);
    const sy = (wy - state.cam.y) * (state.view.scale || 1) + (state.view.y || 0);
    return { x: Math.round(sx), y: Math.round(sy) };
  }

  /* ------------------------- INTERACTION ------------------------- */
  function tryInteract() {
    // Don't start if a minigame/overlay is active
    if (state.mgTorque?.running) return;
    if (els.ovCut?.getAttribute('aria-hidden') === 'false') return;
    if (els.ovBolt?.getAttribute('aria-hidden') === 'false') return;
    const hs = getNearestHotspotWithin(CONFIG.hotspotProximity);
    if (!hs) return;
    state.activeHotspot = hs;
  if (els.dockTask) els.dockTask.textContent = `Active Task: ${hs.type === 'cut' ? 'Precision Cutting' : (hs.type === 'hold' ? 'Hold the Frame' : 'Sequential Torque')}`;
  if (hs.type === 'cut') startCutting(hs);
  else if (hs.type === 'hold') startHold(hs);
  else startTorque(hs);
  }

  /* ---------------------- MINIGAME: CUTTING ---------------------- */
  function startCutting(hs) {
    toggleOverlay(els.ovCut, true);
    els.cutConfirm.disabled = true;
    const c = els.cutCanvas;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;

    // Extract real fragment from base image using the hotspot mask
    const bx = Math.max(0, Math.floor(hs.bbox.minx));
    const by = Math.max(0, Math.floor(hs.bbox.miny));
    const bw = Math.max(1, Math.floor(hs.bbox.maxx - hs.bbox.minx + 1));
    const bh = Math.max(1, Math.floor(hs.bbox.maxy - hs.bbox.miny + 1));
    const ovA = hs.overlayActive; // island alpha mask in bbox space
    // Build masked fragment canvas
    const frag = document.createElement('canvas'); frag.width = bw; frag.height = bh;
    const fctx = frag.getContext('2d');
    // Draw base sub-image of Zone 1 into fragment
    try{ fctx.drawImage(els.imgBase, bx, by, bw, bh, 0, 0, bw, bh); }catch{}
    // Mask by island alpha
    try{ fctx.globalCompositeOperation = 'destination-in'; fctx.drawImage(ovA, 0, 0); fctx.globalCompositeOperation = 'source-over'; }catch{}

    // Compute boundary checkpoints from mask alpha (true edge of fragment)
    const mctx = ovA.getContext('2d');
    const mimg = mctx.getImageData(0,0,bw,bh); const md = mimg.data;
    const boundary = [];
    const step = 2; // subsample pixels
    function alphaAt(x,y){ const i=((y*bw+x)<<2)+3; return md[i]||0; }
    for (let y=1; y<bh-1; y+=step){
      for (let x=1; x<bw-1; x+=step){
        const a = alphaAt(x,y); if (a<10) continue;
        if (alphaAt(x-1,y)<10 || alphaAt(x+1,y)<10 || alphaAt(x,y-1)<10 || alphaAt(x,y+1)<10){
          boundary.push({x,y, hit:false});
        }
      }
    }
    // Downsample further to a reasonable count
    const maxCP = 140; const stride = Math.max(1, Math.floor(boundary.length / maxCP));
    const checkpoints = boundary.filter((_,i)=> i%stride===0);
    const totalCP = checkpoints.length || 1;
    state.mgCut.checkpoints = checkpoints; state.mgCut.hits = 0; state.mgCut.total = totalCP;

    // Layout: scale fragment to fit canvas
    const pad = 28; const sx = (W - pad*2)/bw; const sy = (H - pad*2)/bh; const s = Math.min(sx, sy);
    const offX = (W - bw*s)/2; const offY = (H - bh*s)/2;
    state.mgCut._frag = frag; state.mgCut._scale = s; state.mgCut._offX = offX; state.mgCut._offY = offY;

    // Tool torch state + energy visuals
    let toolX = W/2, toolY = H/2; let lastMX = toolX, lastMY = toolY; let lastSoundAt = 0;
    let heat = 0; let finishedPulse=0; let dropT=0; state.mgCut._raf = 0;
    const sparks = [];

    function spawnSparks(x,y, n){ for (let i=0;i<n;i++){ const ang=Math.random()*Math.PI*2; const sp=30+Math.random()*60; sparks.push({x,y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,t:0,life:0.3+Math.random()*0.5}); } }
    function heatColor(){ const h=Math.max(0,Math.min(1,heat)); if(h<0.33){return `rgba(255,255,${Math.round(255*h/0.33)},0.9)`;} if(h<0.66){const k=(h-0.33)/0.33; return `rgba(255,${Math.round(255*(1-k))},0,0.9)`;} const k=(h-0.66)/0.34; return `rgba(${255-Math.round(80*k)},${50-Math.round(40*k)},0,0.9)`; }
    function drawLightTableBG(){ ctx.fillStyle='#fafafa'; ctx.fillRect(0,0,W,H); const g=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.5,W/2,H/2,Math.max(W,H)*0.9); g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,0.08)'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H); }
    function drawStressNearTool(){ ctx.save(); ctx.globalAlpha=0.08+heat*0.08; ctx.strokeStyle='#000'; ctx.lineWidth=1; const r=36+heat*24; const rings=3; for(let i=1;i<=rings;i++){ const rr=(r*i)/rings; ctx.beginPath(); for(let a=0;a<Math.PI*2; a+=Math.PI/24){ const wob=Math.sin(performance.now()/180 + a*4)*(1+heat*2); const x=toolX + Math.cos(a)*(rr + wob); const y=toolY + Math.sin(a)*(rr + wob*0.7); if(a===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);} ctx.stroke(); } ctx.restore(); }
    function drawTorch(){ const radius=12+heat*8; const grad=ctx.createRadialGradient(toolX,toolY,0,toolX,toolY,radius); grad.addColorStop(0,'rgba(255,255,255,0.95)'); grad.addColorStop(0.4,'rgba(255,220,160,0.45)'); grad.addColorStop(1,'rgba(255,120,60,0.12)'); ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(toolX,toolY,radius,0,Math.PI*2); ctx.fill(); ctx.restore(); }
    function drawSparks(dt){ if(!sparks.length) return; ctx.save(); ctx.globalCompositeOperation='lighter'; for(let i=sparks.length-1;i>=0;i--){ const p=sparks[i]; p.t+=dt; if(p.t>=p.life){ sparks.splice(i,1); continue;} p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=80*dt; const k=1-(p.t/p.life); ctx.globalAlpha=Math.max(0,k)*0.9; ctx.fillStyle=`rgba(255,${Math.round(160+80*k)},${Math.round(60+120*k)},1)`; ctx.beginPath(); ctx.arc(p.x,p.y,1.5+1.5*k,0,Math.PI*2); ctx.fill(); } ctx.restore(); }
    function runCutLoop(now){ const dt=Math.min(0.033, (now - (state.mgCut._lastCutTs||now))/1000); state.mgCut._lastCutTs=now; ctx.clearRect(0,0,W,H); const shake=heat>0.05? (Math.random()-0.5)*(1+heat*2):0; ctx.save(); ctx.translate(shake, -shake*0.5); drawLightTableBG(); const dropY = dropT>0 ? (Math.sin(dropT*3.14)*8) : 0; try{ ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high'; ctx.drawImage(frag,0,0,bw,bh, offX, offY+dropY, bw*s, bh*s);}catch{} const col=heatColor(); ctx.save(); ctx.strokeStyle=col; ctx.lineWidth=2; ctx.shadowColor=col; ctx.shadowBlur=8+heat*12; ctx.beginPath(); for(let i=0;i<checkpoints.length;i++){ const p=checkpoints[i]; const x=offX + p.x*s; const y=offY + p.y*s + dropY; if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);} ctx.stroke(); ctx.restore(); ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.fillStyle='rgba(255,255,255,0.25)'; for(const cp of checkpoints){ if(!cp.hit) continue; const x=offX + cp.x*s; const y=offY + cp.y*s + dropY; ctx.beginPath(); ctx.arc(x,y,3.2,0,Math.PI*2); ctx.fill(); } ctx.restore(); drawStressNearTool(); drawTorch(); drawSparks(dt); if(finishedPulse>0){ const k=finishedPulse; const R=Math.max(W,H)*k; const rg=ctx.createRadialGradient(toolX,toolY,R*0.2,toolX,toolY,R); rg.addColorStop(0,'rgba(255,255,255,0.35)'); rg.addColorStop(1,'rgba(255,255,255,0)'); ctx.save(); ctx.fillStyle=rg; ctx.fillRect(0,0,W,H); ctx.restore(); finishedPulse=Math.max(0, finishedPulse - dt*1.8);} ctx.restore(); state.mgCut._raf = requestAnimationFrame(runCutLoop); }
    state.mgCut._raf = requestAnimationFrame(runCutLoop);

    function onMove(e){
      const rect = c.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (c.width / rect.width);
      const my = (e.clientY - rect.top)  * (c.height / rect.height);
      lastMX = mx; lastMY = my;
      // Resistive motion with human wobble
      toolX += (mx - toolX) * 0.35; toolY += (my - toolY) * 0.35;
      toolX += Math.sin(performance.now()/160)*0.4; toolY += Math.cos(performance.now()/190)*0.35;
      // Hit detection against boundary checkpoints
      let changed = false; const tol = CONFIG.cut.tolerance;
      for (const cp of checkpoints){ if (cp.hit) continue; const x = offX + cp.x*s; const y = offY + cp.y*s; const d = Math.hypot(toolX - x, toolY - y); if (d <= tol) { cp.hit = true; changed = true; } }
      if (changed){
        const count = checkpoints.filter(cp=>cp.hit).length; state.mgCut.hits = count; const coverage = count / totalCP; els.cutConfirm.disabled = (coverage < CONFIG.cut.minCoverage);
      }
      // Heat, sparks, and sizzle based on speed
      const now = performance.now();
      const speed = Math.hypot(mx - toolX, my - toolY);
      heat = Math.max(0, Math.min(1, heat + Math.min(0.06, speed*0.02) - 0.01));
      if (speed > 1.5){ spawnSparks(toolX, toolY, Math.random()<0.5?1:2); }
      if (speed > 1.2 && now - lastSoundAt > 80){ lastSoundAt = now; sizzle(); }
    }
    c.addEventListener('mousemove', onMove); els.cutCanvas._onMove = onMove;
    // Low industrial hum while cutting
    startCutHum();
  }

  function endCutting(success) {
    // cleanup listener
    if (els.cutCanvas._onMove) {
      els.cutCanvas.removeEventListener('mousemove', els.cutCanvas._onMove);
      els.cutCanvas._onMove = null;
    }
    // stop visuals/audio
    try { if (state.mgCut._raf){ cancelAnimationFrame(state.mgCut._raf); state.mgCut._raf = 0; } } catch{}
    stopCutHum();
    if (!success) { toggleOverlay(els.ovCut, false); if (els.dockTask) els.dockTask.textContent = 'None'; return; }

  const coverage = state.mgCut.hits / (state.mgCut.total || 1);
    const yieldUnits = Math.round(40 + 70*coverage);    // 40–110
    const qualityHit = Math.round((1-coverage)*10);      // up to -10%

    state.salvage += yieldUnits;
    state.crates += 1;
    state.quality = Math.max(0, state.quality - qualityHit);

  finishHotspotSuccess(`Cut complete • Precision ${(coverage*100)|0}% • +${yieldUnits} salvage`);
    // Crowd reaction intensity based on precision
    try{
      const tone = coverage < 0.6 ? 'heavy' : (coverage < 0.8 ? 'warn' : 'positive');
      const kind = coverage < 0.6 ? 'heavy' : (coverage < 0.8 ? 'tense' : 'positive');
      burstVoicesNear(state.player.x, state.player.y, 3, kind);
    }catch{}

    // Completion cooling flash + drop, then close overlay
    try{
      const c = els.cutCanvas; const ctx = c.getContext('2d');
      const frag = state.mgCut._frag; const s = state.mgCut._scale; const offX = state.mgCut._offX; const offY0 = state.mgCut._offY;
      const W=c.width, H=c.height; let t=0; const dur=380; clink();
      function anim(){
        t = Math.min(1, t + 1/60 * (1000/dur));
        ctx.clearRect(0,0,W,H);
        // light-table background
        ctx.fillStyle='#fafafa'; ctx.fillRect(0,0,W,H);
        const dy = Math.sin(t*Math.PI) * 10;
        try{ ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high'; ctx.drawImage(frag,0,0,frag.width,frag.height, offX, offY0 + dy, frag.width*s, frag.height*s);}catch{}
        const alpha = 0.25*(1-t);
        ctx.fillStyle = `rgba(230,235,240,${alpha})`; ctx.fillRect(0,0,W,H);
        if (t < 1){ requestAnimationFrame(anim); } else {
          toggleOverlay(els.ovCut, false);
          if (els.dockTask) els.dockTask.textContent = 'None';
          // Hold-the-Frame no longer auto-chains
        }
      }
      requestAnimationFrame(anim);
    }catch{
  toggleOverlay(els.ovCut, false);
  if (els.dockTask) els.dockTask.textContent = 'None';
  // Hold-the-Frame no longer auto-chains
    }

    updateHUD();
  }

  /* ---------------- MINIGAME: SEQUENTIAL TORQUE ----------------- */
  // Shared draw helper so both the live loop and completion animation can render
  function drawTorqueGauge(ctx, canvas){
    const mg = state.mgTorque;
    if (!ctx || !canvas) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    // base panel (light table style)
    ctx.save();
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0,0,W,H);
    ctx.translate(W/2, H/2);

    // timer ring (outer) based on remaining time
    const total = CONFIG.torque.timeLimitMs;
    const leftMs = Math.max(0, mg.deadline ? (mg.deadline - performance.now()) : total);
    const tFrac = Math.max(0, Math.min(1, leftMs / total));
    const ringR = Math.min(W,H)*0.44;
    ctx.lineWidth = 8;
    // background ring (light grey on white)
    ctx.strokeStyle = 'rgba(0,0,0,.08)';
    ctx.beginPath(); ctx.arc(0,0, ringR, 0, Math.PI*2); ctx.stroke();
  // foreground ring (countdown)
    const startA = -Math.PI/2;
    const endA = startA + (Math.PI*2 * tFrac);
  // Always render countdown in red to emphasize time pressure
  ctx.strokeStyle = '#cc0000';
    ctx.beginPath(); ctx.arc(0,0, ringR, startA, endA, false); ctx.stroke();

    // dial circle
    const R = Math.min(W,H)*0.36;
    ctx.strokeStyle = '#e3e7ee'; ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0,0,R,0,Math.PI*2); ctx.stroke();
    // ticks
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 2;
    for (let i=0;i<60;i++){
      const ang=i*(Math.PI*2/60); const r1=R-8, r2=R-18;
      ctx.beginPath(); ctx.moveTo(Math.cos(ang)*r1, Math.sin(ang)*r1); ctx.lineTo(Math.cos(ang)*r2, Math.sin(ang)*r2); ctx.stroke();
    }
    // green zone arc
    const s = mg.zoneStart - Math.PI/2; // rotate so 0 at top
    const e = mg.zoneEnd   - Math.PI/2;
    ctx.strokeStyle = '#2fbf7a'; ctx.lineWidth = 14; ctx.lineCap='round';
    if (mg.zoneStart <= mg.zoneEnd){
      ctx.beginPath(); ctx.arc(0,0,R, s, e); ctx.stroke();
    } else {
      // wrapped zone: draw in two segments
      ctx.beginPath(); ctx.arc(0,0,R, s, s + Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0,0,R, -Math.PI/2, e); ctx.stroke();
    }

    // bolt visualization at center (rotates as hits accrue)
    ctx.save();
    const slide = mg.slideY || 0; 
    ctx.translate(0, -slide);
    ctx.rotate(mg.boltAngle);
    ctx.fillStyle = '#c7ccd6';
    ctx.beginPath(); ctx.rect(-10,-10,20,20); ctx.fill();
    ctx.strokeStyle = '#3a445b'; ctx.lineWidth = 2; ctx.strokeRect(-10,-10,20,20);
    ctx.restore();

    // needle
    const a = mg.angle - Math.PI/2;
    ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*R, Math.sin(a)*R); ctx.stroke();

    // hub
    ctx.fillStyle='#333'; ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();

    // feedback flashes
    if (mg.flashUntil && performance.now() < mg.flashUntil){
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = mg.flashKind==='hit' ? '#43d18a' : '#ff5b5b';
      ctx.beginPath(); ctx.arc(0,0,R+18,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // text
    ctx.fillStyle = '#111'; ctx.font = '600 20px system-ui,Segoe UI'; ctx.textAlign='center';
    ctx.fillText('Apply Torque', 0, -R-24);
    ctx.restore();
  }
  function startTorque(hs){
    const c = els.torqueCanvas;
    const ctx = c?.getContext('2d');
  if (!c || !ctx) { __dbg.warn('Torque canvas missing'); return; }
    toggleOverlay(els.ovBolt, true);
    // initialize state
    const mg = state.mgTorque;
    mg.running = true;
    mg.progress = 0;
    mg.hits = 0; mg.misses = 0;
    mg.zoneWidthDeg = CONFIG.torque.startZoneDeg;
  mg.angle = 0; mg.lastRot = 0; mg.boltAngle = 0; mg.flashKind=''; mg.flashUntil=0;
  mg.slideY = 0;
  mg.deadline = performance.now() + CONFIG.torque.timeLimitMs;
  mg._nextTickAt = performance.now();
    // Dynamic per-run difficulty: 3–5 hits to finish
  mg.targetHits = randInt(3,5);
    mg.successGain = Math.round(100 / mg.targetHits);
    mg.hitsToLoosen = mg.targetHits; // keep visual rotation in sync with successes
  mg.attempts = 0; // total keypresses
  mg.finalized = false; // prevent double end
    randomizeZone();

    // input: press E or Space to attempt
    function onKey(e){
      if (!mg.running) return;
      const k = e.key.toLowerCase();
      if (k !== 'e' && k !== ' ') return;
      e.preventDefault();
      mg.attempts++;
      evaluateTorqueHit();
    }
    window.addEventListener('keydown', onKey);
    c._onKey = onKey;

    // start loop
    const startTs = performance.now();
    function loopTorque(){
      if (!mg.running) return;
      const now = performance.now();
      const dt = Math.min(0.033, (now - (state._lastTorqueTs||now))/1000);
      state._lastTorqueTs = now;
      // advance needle
      const perSec = CONFIG.torque.rotationHz;
      mg.angle += dt * perSec * Math.PI*2;
      // detect wrap-around for new zone each rotation
      const rot = Math.floor(mg.angle / (Math.PI*2));
      if (rot !== mg.lastRot){ mg.lastRot = rot; randomizeZone(); }
      // timeout?
      if (performance.now() >= mg.deadline){
        // time up: fail with no salvage, mark part as inactive/grey
        mg.flashKind='miss'; mg.flashUntil=performance.now()+CONFIG.torque.flashMs;
        updateTorqueReadout();
        endTorque(false, { timedOut: true });
        return;
      }
      // subtle ticking (once per second)
      if (performance.now() >= (mg._nextTickAt || 0)){
        tick();
        mg._nextTickAt = performance.now() + 1000;
      }
      drawTorqueGauge(ctx, c);
      mg.loopId = requestAnimationFrame(loopTorque);
    }
    mg.loopId = requestAnimationFrame(loopTorque);

    function randomizeZone(){
      const widthRad = (mg.zoneWidthDeg*Math.PI)/180;
      const start = Math.random() * (Math.PI*2);
      mg.zoneStart = start;
      mg.zoneEnd = (start + widthRad) % (Math.PI*2);
    }

    function evaluateTorqueHit(){
      // Check if current angle lies within the green arc
      const a = (mg.angle % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
      let inZone = false;
      if (mg.zoneStart <= mg.zoneEnd) {
        inZone = (a >= mg.zoneStart && a <= mg.zoneEnd);
      } else {
        // wrapped zone
        inZone = (a >= mg.zoneStart || a <= mg.zoneEnd);
      }
      if (inZone){
        mg.progress = Math.min(100, mg.progress + (mg.successGain || CONFIG.torque.successGain));
        mg.hits += 1;
        mg.zoneWidthDeg = Math.max(CONFIG.torque.minZoneDeg, mg.zoneWidthDeg - CONFIG.torque.zoneShrinkDeg);
        mg.boltAngle += (Math.PI*2)/(mg.hitsToLoosen || CONFIG.torque.hitsToLoosen);
        mg.flashKind = 'hit'; mg.flashUntil = performance.now() + CONFIG.torque.flashMs;
        click();
        // success check by hit count
        if (mg.hits >= mg.targetHits){
          mg.progress = 100;
          updateTorqueReadout();
          endTorque(true);
          return;
        }
      } else {
        mg.progress -= CONFIG.torque.missLoss;
        mg.misses += 1;
        mg.flashKind = 'miss'; mg.flashUntil = performance.now() + CONFIG.torque.flashMs;
        grind();
        if (mg.progress <= CONFIG.torque.failUnder){
          // soft reset
          mg.progress = 0; mg.hits = 0; mg.boltAngle = 0; mg.zoneWidthDeg = CONFIG.torque.startZoneDeg;
        }
      }
      updateTorqueReadout();
    }

    // initial paint
    drawTorqueGauge(ctx, c);

    function updateTorqueReadout(){
      const pct = Math.max(0, Math.min(100, Math.round(mg.progress)));
      const msLeft = Math.max(0, Math.round(mg.deadline - performance.now()));
      const sLeft = Math.ceil(msLeft/1000);
      els.torqueReadout.textContent = `Bolt Integrity: ${Math.max(0,100-pct)}% — ${sLeft}s`;
    }
  }

  /* ---------------- MINIGAME: HOLD THE FRAME ----------------- */
  function startHold(hs){
    const c = els.holdCanvas; const ctx = c?.getContext('2d');
  if (!c || !ctx){ __dbg.warn('Hold canvas missing'); return; }
    toggleOverlay(els.ovHold, true);
    const mg = state.mgHold;
    Object.assign(mg, { running:true, angle:0, angVel:0, sway:0, stableFor:0, fail:false, startAt:performance.now(), clampsAt:0, deadline: performance.now() + (CONFIG.hold?.timeLimitMs||20000), lastWarnAt:0, bgT:0, sparks:[], lastZone:'white' });
    // Initial nudge and ambient creak
    mg.angVel = (Math.random()*0.6 - 0.3) * 0.5; // small initial drift
    startHoldHum();
    // loop
    const loop = () => {
      if (!mg.running) return;
      const now = performance.now();
      const dt = 1/60; // fixed for stable feel
      mg.bgT += dt;
      // External forces: slow sinusoid + pink-ish jitter
      const tremor = (Math.random()-0.5) * (CONFIG.hold?.tremor?.amp||0.006);
      const wind = Math.sin(now*0.0013)*0.03 + tremor;
      const mass = 0.98;               // inertia
      const damp = 0.982;              // global damping (heavier)
      const controlK = 0.18;           // player correction strength (slower)
      const overK = 0.10;              // non-linear overcorrection tendency
      // Read control input (arrow keys/A-D)
      const left = !!(state.keys['ArrowLeft']||state.keys['a']||state.keys['A']);
      const right = !!(state.keys['ArrowRight']||state.keys['d']||state.keys['D']);
      let ctrl = 0; if (left) ctrl -= 1; if (right) ctrl += 1;
      // Non-linear response to encourage micro adjustments
      const ctrlForce = controlK * ctrl - overK * mg.angVel * ctrl;
      // Update physics
      mg.angVel = (mg.angVel + (wind + ctrlForce)) * damp;
      mg.angle = mg.angle + mg.angVel * dt;
      // Stability evaluation
      const absA = Math.abs(mg.angle);
      let zone = 'white';
      if (absA > mg.threshold.red) zone = 'red';
      else if (absA > mg.threshold.amber) zone = 'amber';
      // Accumulate stable time when in white
      if (zone === 'white') mg.stableFor += dt*1000; else mg.stableFor = Math.max(0, mg.stableFor - dt*400);
      // Fail if exceed hard limit
      const hard = mg.threshold.red * 1.4;
      if (absA > hard){
        endHold(false, { collapse:true });
        return;
      }
      // Timer urgency and warning beeps
      const leftMs = Math.max(0, (mg.deadline - now));
      if (leftMs <= 0){ endHold(false, { timeout:true }); return; }
      const warns = (CONFIG.hold?.warnAtMs)||[];
      for (const w of warns){ if (leftMs < w && mg.lastWarnAt !== w){ mg.lastWarnAt = w; tick(); } }
      // Audio hum intensity follows instability
      updateHoldHum(absA);
      // Occasional intercom during danger
      if (zone !== mg.lastZone && zone !== 'white'){
        try{
          const line = zone==='amber' ? 'Hold it steady!' : 'We are losing it!';
          speakNearestAgent(line, state.player.x, state.player.y, zone==='amber'?'warn':'heavy');
        }catch{}
      }
      mg.lastZone = zone;
      drawHold(ctx, c, mg, zone);
      if (mg.stableFor >= mg.requireMs){ endHold(true); return; }
      mg.raf = requestAnimationFrame(loop);
    };
    mg.raf = requestAnimationFrame(loop);
  }

  function drawHold(ctx, canvas, mg, zone){
    const W=canvas.width, H=canvas.height; ctx.clearRect(0,0,W,H);
    // background isolation
    ctx.fillStyle = '#f7f8fa'; ctx.fillRect(0,0,W,H);
    // Environment silhouettes: cranes/scaffolding and faint crowd hints
    if (CONFIG.hold?.env?.silhouettes){
      ctx.save(); ctx.globalAlpha = 0.07; ctx.strokeStyle = '#1b2438'; ctx.lineWidth = 2;
      // simple crane outline left
      ctx.beginPath(); ctx.moveTo(90, H*0.65); ctx.lineTo(220,120); ctx.lineTo(260,120); ctx.lineTo(180, H*0.65); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W-120, H*0.7); ctx.lineTo(W-260, 140); ctx.lineTo(W-220, 140); ctx.lineTo(W-160, H*0.7); ctx.stroke();
      ctx.restore();
    }
    if (CONFIG.hold?.env?.crowdHints){
      ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = '#0e0f12';
      for (let i=0;i<14;i++){ const x = (i*W/14) + ((i%2)*10); const y = H*0.85 + Math.sin((mg.bgT*0.8)+i)*3; ctx.fillRect(x, y, 5, 16);} ctx.restore();
    }
  // Living stability bar (mechanical gauge)
    const barH=12; const pad=16; const frac = Math.min(1, Math.abs(mg.angle)/(mg.threshold.red*1.2));
    const wobble = (Math.sin(mg.bgT*13) * 0.03) + (mg.angVel*0.08);
    const effective = Math.max(0, Math.min(1, (1-frac) + wobble));
    const col = zone==='white'?'#ffffff': zone==='amber'?'#ffbf3b':'#ff5b5b';
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(pad,pad,W-pad*2,barH);
    ctx.fillStyle = col; ctx.fillRect(pad,pad, (W-pad*2)*effective, barH);
    // Analog tick marks
    ctx.save(); ctx.globalAlpha=0.35; ctx.strokeStyle='rgba(0,0,0,0.25)'; for(let i=0;i<=10;i++){ const x=pad + (W-pad*2)*(i/10); ctx.beginPath(); ctx.moveTo(x,pad); ctx.lineTo(x,pad+barH); ctx.stroke(); } ctx.restore();
  // Hold timer/progress (how long to keep stable)
  const holdPadTop = pad + barH + 10;
  const reqMs = mg.requireMs || 4000; const remaining = Math.max(0, (reqMs - mg.stableFor));
  const holdFrac = Math.max(0, Math.min(1, mg.stableFor / reqMs));
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(pad,holdPadTop,W-pad*2,barH);
  ctx.fillStyle = '#2fbf7a'; // progress to clamp
  ctx.fillRect(pad,holdPadTop, (W-pad*2)*holdFrac, barH);
  // Label: remaining seconds
  ctx.save(); ctx.fillStyle = '#0f5132'; ctx.font = '600 13px system-ui,Segoe UI'; ctx.textAlign = 'right';
  ctx.fillText(`Hold steady: ${(remaining/1000).toFixed(1)}s`, W-pad, holdPadTop - 3);
  ctx.restore();
  // Background tinting removed: keep the overlay background flat
    // Suspended component
    ctx.save();
    const cx=W/2, cy=H*0.52; // pivot point
    // overhead light and cables
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(0,0,W,40);
    // Cables
    ctx.strokeStyle = 'rgba(40,48,66,0.6)'; ctx.lineWidth=3;
    const spread=120; const stretch = mg.angle*40;
    ctx.beginPath(); ctx.moveTo(cx-spread,0); ctx.lineTo(cx-40,cy-170 + stretch); ctx.moveTo(cx+spread,0); ctx.lineTo(cx+40,cy-170 - stretch); ctx.stroke();
    // Shadow follows sway
    const shOff = mg.angle*120;
    ctx.save(); ctx.translate(shOff,20); ctx.fillStyle='rgba(0,0,0,0.08)'; ctx.beginPath(); ctx.ellipse(cx, H*0.88, 220, 26, 0,0,Math.PI*2); ctx.fill(); ctx.restore();
    // Payload
    ctx.translate(cx, cy);
    ctx.rotate(mg.angle);
    const w=380,h=180; ctx.fillStyle='#d7dde7'; ctx.strokeStyle='#2a344b'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.roundRect?.(-w/2,-h/2,w,h,18);
    if (!ctx.roundRect){ ctx.rect(-w/2,-h/2,w,h); }
    ctx.fill(); ctx.stroke();
    // panel seams
    ctx.strokeStyle='rgba(0,0,0,0.18)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-w/2+20,-h/2+50); ctx.lineTo(w/2-20,-h/2+50); ctx.moveTo(-w/2+20,h/2-50); ctx.lineTo(w/2-20,h/2-50); ctx.stroke();
    // Micro stress visuals near edges when red
    if (zone==='red'){
      ctx.save(); ctx.strokeStyle='rgba(255,90,90,0.6)'; ctx.lineWidth=1;
      for (let i=0;i<3;i++){ const rx=(Math.random()-0.5)*w*0.6, ry=(Math.random()-0.5)*h*0.5; ctx.beginPath(); ctx.moveTo(rx, -h/2); ctx.lineTo(rx + Math.random()*8 - 4, -h/2 - 8 - Math.random()*10); ctx.stroke(); }
      ctx.restore();
    }
    ctx.restore();
    // Status text
    ctx.save();
    ctx.fillStyle = zone==='white' ? '#111' : (zone==='amber' ? '#9a5d00' : '#a10000');
    ctx.font='600 18px system-ui,Segoe UI'; ctx.textAlign='center';
    const tx = zone==='white' ? 'Stable' : zone==='amber' ? 'Tilting' : 'UNSTABLE';
    const jitter = zone==='white' ? 0 : (zone==='amber' ? 1.5 : 3.5);
    ctx.fillText(tx, W/2 + (Math.random()-0.5)*jitter, H-24 + (Math.random()-0.5)*jitter);
    ctx.restore();
    // Sparks near cable joins when red
    if (zone==='red'){
      ctx.save(); ctx.globalAlpha=0.7; ctx.strokeStyle='#ffcf57'; ctx.lineWidth=2;
      const sx1 = W/2 - 40, sy1 = H*0.52 - 170 + stretch; const sx2 = W/2 + 40, sy2 = H*0.52 - 170 - stretch;
      for (let i=0;i<2;i++){ const dx = (Math.random()*14-7), dy = (Math.random()*10-5); ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx1+dx, sy1+dy); ctx.stroke(); }
      for (let i=0;i<2;i++){ const dx = (Math.random()*14-7), dy = (Math.random()*10-5); ctx.beginPath(); ctx.moveTo(sx2, sy2); ctx.lineTo(sx2+dx, sy2+dy); ctx.stroke(); }
      ctx.restore();
    }
  }

  function endHold(success, opts={}){
    const mg = state.mgHold; if (!mg.running) return; mg.running = false; if (mg.raf) cancelAnimationFrame(mg.raf);
    const c = els.holdCanvas; const ctx = c?.getContext('2d');
    stopHoldHum();
    if (success){
      // Success: clamp lock animation and sound gap
      let t=0; const dur=600; const pause=300; // brief silence
      function anim(){
        t = Math.min(1, t + 1/60 * (1000/dur));
        drawHold(ctx, c, mg, 'white');
        // brighten wash
        ctx.save(); ctx.globalAlpha = 0.2*(1-t); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,c.width,c.height); ctx.restore();
        if (t<1){ requestAnimationFrame(anim); } else {
          // thunk + hiss
          try{ clunk(); sizzle(); }catch{}
          toggleOverlay(els.ovHold, false);
          if (els.dockTask) els.dockTask.textContent = 'None';
          finishHotspotSuccess('Load secured • Balance achieved • +30 salvage');
          state.salvage += 30;
        }
      }
      anim();
    } else {
      // Failure: flicker UNSTABLE, shake, decrease quality and increase people waiting
      const lossQ = 6, incP = 12;
      state.quality = Math.max(0, state.quality - lossQ);
      adjustPeopleWaiting(incP, { reason:'holdFail' });
      let t=0; const dur=700; const shakeAmp=12; const text='UNSTABLE';
      function anim(){
        t = Math.min(1, t + 1/60 * (1000/dur));
        const offX = Math.sin(performance.now()*0.06)*shakeAmp*(1-t);
        const offY = Math.cos(performance.now()*0.05)*shakeAmp*(1-t);
        const W=c.width,H=c.height; ctx.save(); ctx.translate(offX, offY);
        drawHold(ctx, c, mg, 'red'); ctx.restore();
        ctx.save(); ctx.globalAlpha = 0.85*(1-t); ctx.fillStyle='#ff2d2d'; ctx.font='800 38px system-ui,Segoe UI'; ctx.textAlign='center'; ctx.fillText(text, W/2, 50);
        ctx.restore();
        if (t<1){ requestAnimationFrame(anim); } else { toggleOverlay(els.ovHold, false); if (els.dockTask) els.dockTask.textContent = 'None';
          // Persistent crash tail into the world: a few groans after closing + tense voices
          try{
            setTimeout(()=>grind(), 180);
            setTimeout(()=>clunk(), 360);
            burstVoicesNear(state.player.x, state.player.y, 3, 'heavy');
          }catch{}
        }
      }
      anim();
    }
  }

  // --- Hold-the-Frame hum (pitch/volume scale with instability) ---
  let _holdHumOsc = null, _holdHumGain = null;
  function startHoldHum(){
    const ac = getAudio(); if (!ac || _holdHumOsc) return;
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = CONFIG.hold?.audio?.baseFreq || 55; g.gain.value = CONFIG.hold?.audio?.baseGain || 0.02;
    o.connect(g).connect(ac.destination); o.start(); _holdHumOsc = o; _holdHumGain = g;
  }
  function stopHoldHum(){ try{ _holdHumOsc?.stop(); }catch{} try{ _holdHumOsc?.disconnect(); }catch{} try{ _holdHumGain?.disconnect(); }catch{} _holdHumOsc=null; _holdHumGain=null; }
  function updateHoldHum(instability){
    const a = CONFIG.hold?.audio || {}; const f0=a.baseFreq||55, f1=a.maxFreq||160; const g0=a.baseGain||0.02, g1=a.maxGain||0.08;
    if (_holdHumOsc) _holdHumOsc.frequency.value = f0 + (f1-f0) * Math.min(1, instability/ (state.mgHold.threshold.red || 0.32));
    if (_holdHumGain) _holdHumGain.gain.value = g0 + (g1-g0) * Math.min(1, instability/ (state.mgHold.threshold.red || 0.32));
  }

  function endTorque(success, opts={}){
    const mg = state.mgTorque;
    if (mg.finalized) return; // guard
    mg.finalized = true;
    // cleanup
    if (els.torqueCanvas?._onKey){ window.removeEventListener('keydown', els.torqueCanvas._onKey); els.torqueCanvas._onKey = null; }
    if (!success){
      if (mg.loopId){ cancelAnimationFrame(mg.loopId); mg.loopId = 0; }
      if (mg.animId){ cancelAnimationFrame(mg.animId); mg.animId = 0; }
      mg.running = false;
      mg._nextTickAt = 0;
  toggleOverlay(els.ovBolt, false);
  if (els.dockTask) els.dockTask.textContent = 'None';
      // If timed out: mark hotspot inactive/grey with no salvage
      if (opts && opts.timedOut && state.activeHotspot){
        state.activeHotspot.completed = true;
        // Start crossfade to grey (no particle burst)
        try {
          const dur = randInt(CONFIG.shimmer.msMin, CONFIG.shimmer.msMax);
          const now = performance.now();
          state.activeHotspot.fadeStartTs = now;
          state.activeHotspot.fadeDur = dur;
          state.activeHotspot.fadeEndTs = now + dur;
        } catch {}
        toast('Time up — part seized. No salvage awarded.', 'warn');
      }
      return;
    }

    // award based on performance (hits vs misses)
  // Performance-based salvage using accuracy and efficiency
  const accuracy = Math.max(0, Math.min(1, mg.hits/(mg.hits + mg.misses || 1)));
  const efficiency = Math.max(0.4, Math.min(1, mg.targetHits / Math.max(1, mg.attempts)));
  const perf = (accuracy*0.7 + efficiency*0.3);
  const yieldUnits = Math.round(40 + 80*perf);   // 40–120 based on performance
  const qualityHit = Math.round((1-accuracy)*10); // worse accuracy -> more quality penalty
  state.salvage += yieldUnits; state.crates += 1; state.quality = Math.max(0, state.quality - qualityHit);
    clunk();

    // Ensure 0% is visible during completion
  try { els.torqueReadout.textContent = 'Bolt Integrity: 0% — Released'; } catch {}
    // play quick slide-up animation then close
    // stop loop immediately and run quick release animation
    if (mg.loopId){ cancelAnimationFrame(mg.loopId); mg.loopId = 0; }
    mg.running = false;
  mg._nextTickAt = 0;
    const ctx = els.torqueCanvas.getContext('2d');
    const start = performance.now();
    const dur = 280;
    function anim(){
      const now = performance.now();
      const t = Math.min(1, (now - start)/dur);
      const ease = t<0.5? 2*t*t : 1 - Math.pow(-2*t + 2, 2)/2; // easeInOutQuad
      mg.slideY = ease * (els.torqueCanvas.height * 0.3);
      drawTorqueGauge(ctx, els.torqueCanvas);
      if (t < 1){ mg.animId = requestAnimationFrame(anim); }
      else {
        if (mg.animId){ cancelAnimationFrame(mg.animId); mg.animId = 0; }
        toggleOverlay(els.ovBolt, false);
        try { spawnBurstAt(state.activeHotspot.cx, state.activeHotspot.cy); } catch {}
    finishHotspotSuccess(`Bolt released • Acc ${(accuracy*100)|0}% • Eff ${(efficiency*100)|0}% • +${yieldUnits} salvage`);
  updateHUD();
        mg.slideY = 0;
        try{ if (mg.closeTimeoutId) { clearTimeout(mg.closeTimeoutId); mg.closeTimeoutId = null; } }catch{}
      }
    }
    anim();
    // safety fallback: force close and finalize even if animation stalls
    try{ if (mg.closeTimeoutId) clearTimeout(mg.closeTimeoutId); }catch{}
    mg.closeTimeoutId = setTimeout(() => {
      const open = els.ovBolt?.getAttribute('aria-hidden') === 'false';
      if (open){
        toggleOverlay(els.ovBolt, false);
        try { spawnBurstAt(state.activeHotspot.cx, state.activeHotspot.cy); } catch {}
  finishHotspotSuccess(`Bolt released • Acc ${(accuracy*100)|0}% • Eff ${(efficiency*100)|0}% • +${yieldUnits} salvage`);
  updateHUD();
      }
    }, 900);
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

  // Optionally chain Hold-the-Frame after another mini-game
  function maybeStartHold(prev){
    const cfg = CONFIG.hold || {}; if (!cfg.enabled) return;
    const ok = cfg.autoAfter === 'either' || cfg.autoAfter === prev;
    if (!ok) return; if (Math.random() > (cfg.chance ?? 1)) return;
  try{ startHold(state.activeHotspot); }catch(e){ __dbg.warn('Hold failed to start:', e); }
  }

  // --- Minimal audio cues (synthesized) ---
  let _audioCtx = null;
  function getAudio(){
    if (!_audioCtx) { try{ _audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch{} }
    return _audioCtx;
  }
  function beep(freq=800, dur=0.06, type='square', vol=0.08){
    const ac = getAudio(); if (!ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g).connect(ac.destination);
    o.start(t); o.stop(t + dur);
  }
  function click(){ beep(1400, 0.04, 'square', 0.06); }
  function grind(){ beep(220, 0.08, 'sawtooth', 0.06); }
  function clunk(){ beep(120, 0.12, 'triangle', 0.08); }
  function sizzle(){ beep(3200, 0.02, 'square', 0.03); }
  function clink(){ beep(1800, 0.05, 'triangle', 0.06); beep(900, 0.06, 'sine', 0.04); }

  // Subtle tick (low volume) called roughly once per second
  function tick(){ beep(800, 0.02, 'square', 0.03); }

  // Hum removed: keep stop function to silence if previously created
  let _humNode = null, _humGainNode = null;
  function stopHum(){
    try{ _humNode?.stop(); }catch{}
    try{ _humNode?.disconnect(); }catch{}
    try{ _humGainNode?.disconnect(); }catch{}
    _humNode = null; _humGainNode = null;
  }

  // Cutting hum layer
  let _cutHumOsc = null, _cutHumGain = null;
  function startCutHum(){
    const ac = getAudio(); if (!ac) return; if (_cutHumOsc) return;
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.value = 70; g.gain.value = 0.02;
    o.connect(g).connect(ac.destination); o.start(); _cutHumOsc = o; _cutHumGain = g;
  }
  function stopCutHum(){ try{ _cutHumOsc?.stop(); }catch{} try{ _cutHumOsc?.disconnect(); }catch{} try{ _cutHumGain?.disconnect(); }catch{} _cutHumOsc=null; _cutHumGain=null; }

  function updateHUD() {
    els.hudSalvage.textContent = state.salvage;
    els.hudQuality.textContent = `${state.quality}%`;
    els.hudCrates.textContent = state.crates;
    try { if (els.hudPeople) els.hudPeople.textContent = state.peopleWaiting|0; } catch{}
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
    if (els.dockTask) els.dockTask.textContent = 'None';
    // Clear plane overlays fully
    state.overlays = [];
    state.nextArrivalAt = performance.now() + state.planeTimerMs;
    state.planeClearedUntil = 0;
    // Optional: clear residue visual memory on explicit reset (keep between cycles otherwise)
    try { if (state.residueCtx){ state.residueCtx.clearRect(0,0,state.baseW,state.baseH); state.residueScore = 0; } } catch{}
    updateHUD();
    toast('Zone reset.');
  }

  function finishHotspotSuccess(msg) {
    if (!state.activeHotspot) return;
    state.activeHotspot.completed = true;
    if (state.activeHotspot.pipEl) state.activeHotspot.pipEl.style.display = 'none';
    // start overlay crossfade with tactile shimmer duration (0.3–0.6s)
    try {
      const dur = randInt(CONFIG.shimmer.msMin, CONFIG.shimmer.msMax);
      const now = performance.now();
      state.activeHotspot.fadeStartTs = now;
      state.activeHotspot.fadeDur = dur;
      state.activeHotspot.fadeEndTs = now + dur;
    } catch {}
    try { spawnBurstAt(state.activeHotspot.cx, state.activeHotspot.cy); } catch {}
    toast(msg, 'ok');
    if (els.dockTask) els.dockTask.textContent = 'None';

    // If all hotspots completed: show simple results
    const remaining = state.hotspots.filter(h=>!h.completed).length;
    if (remaining === 0) {
      try{ planeCleared(); }catch{}
      showResults();
    }

    // Logistics: spawn a crate with a short delay (for pop-in) unless the truck is already in transit
    try {
      const hs = state.activeHotspot;
      if (!state.truck.inTransit && hs && !hs._crateSpawned){
        hs._crateSpawned = true;
        const { spawnDelayMs=420 } = CONFIG.crate || {};
        const hx = hs.cx, hy = hs.cy;
        setTimeout(()=> spawnCrateAt(hx, hy), spawnDelayMs);
      }
    } catch{}
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

  // --- Avatar sprite selection and sizing ---
  function setAvatarSprite(){
    // Desired figure name
    const want = (CONFIG.avatar?.preferredName || 'figure5.png').toLowerCase();
    // 1) Prefer DOM-provided images
    let candidates = [];
    try{
      candidates = Array.from(document.querySelectorAll('img[data-silhouette], img.silhouette'));
    }catch{}
    // 2) Add any already-loaded silhouettes
    if (Array.isArray(state.silImgs) && state.silImgs.length){
      candidates = candidates.concat(state.silImgs);
    }
    // Pick exact match by filename if possible
    let chosen = candidates.find(n => (n.src||'').toLowerCase().includes(want));
    if (!chosen){
      // Fallback: first available
      chosen = candidates[0];
    }
    if (chosen && chosen.naturalWidth){
      avatarImg.src = chosen.src;
    } else {
      // Last-chance: try probing common paths just for figure5
      const cands = [
        'silhouettes/figure5.png',
        'assets/silhouettes/figure5.png',
        'assets/figures/figure5.png',
        'figure5.png'
      ];
      probeOne(cands, (src)=>{ avatarImg.src = src; });
    }
    // Set size from CONFIG
    const h = CONFIG.avatar?.heightPx || 24;
    avatarImg.style.height = `${h}px`;
  }

  function probeOne(list, onOk){
    let i=0; const next=()=>{
      if (i>=list.length) return;
      const src = list[i++];
      const im = new Image();
      im.onload = ()=> onOk?.(src);
      im.onerror = ()=> next();
      im.src = src;
    }; next();
  }

  /* ---------------------- LOGISTICS: CRATES ---------------------- */
  function spawnCrateAt(wx, wy){
    const id = state.nextCrateId++;
    const c = { id, x: wx, y: wy, w: CONFIG.crate.w, h: CONFIG.crate.h, carrying: false, loaded: false, alpha: 0, spawnAt: performance.now(), glintUntil: 0 };
    state.cargoCrates.push(c);
    toast(`Crate #${id} ready for pickup`, 'ok');
  }

  function getNearestCrateWithin(r){
    let best=null, bestD=Infinity;
    for (const c of state.cargoCrates){ if (c.loaded) continue; const d=Math.hypot(c.x - state.player.x, c.y - state.player.y); if (d<r && d<bestD){ best=c; bestD=d; } }
    return best;
  }

  function tryCrateOrTruckInteract(){
    // Pick up crate if close and not carrying
    if (!state.carryingCrateId){
      const near = getNearestCrateWithin(CONFIG.crate.pickupRadius);
      if (near){ state.carryingCrateId = near.id; near.carrying = true; toast(`Picked up crate #${near.id}`,'ok'); return true; }
    } else {
      // Attempt drop on truck if close
      if (isNearTruck(state.player.x, state.player.y)){
        const ok = dropCrateOnTruck();
        if (ok) return true;
      }
    }
    return false;
  }

  function isNearTruck(wx, wy){
    const t = state.truck; const margin = 40;
    return (wx >= t.x - margin && wx <= t.x + t.w + margin && wy >= t.y - margin && wy <= t.y + t.h + margin);
  }

  function dropCrateOnTruck(){
    const c = state.cargoCrates.find(k => k.id === state.carryingCrateId);
    if (!c) { state.carryingCrateId = null; return false; }
    const t = state.truck;
    if (t.slots.length >= CONFIG.truck.slots) { toast('Truck is full','warn'); return false; }
    // Snap to next slot (slots arranged along the top of the truck body)
    const idx = t.slots.length;
    const slotDx = 20 + idx* (CONFIG.crate.w + 10);
    const slotDy = 10;
    t.slots.push({ id: c.id, dx: slotDx, dy: slotDy });
    c.loaded = true; c.carrying = false; state.carryingCrateId = null;
    toast(`Loaded crate #${c.id} (${t.slots.length}/${CONFIG.truck.slots})`, 'ok');
    state.cratesLoaded += 1;
    if (t.slots.length >= CONFIG.truck.slots) { startTruckCycle(); }
    return true;
  }

  function updateCratesFollow(){
    if (!state.carryingCrateId) return;
    const c = state.cargoCrates.find(k=>k.id===state.carryingCrateId);
    if (!c) { state.carryingCrateId = null; return; }
    // Follow player with slight offset
    c.x = state.player.x + 14; c.y = state.player.y + 6;
  }

  function drawCrates(ctx){
    const now = performance.now();
    for (const c of state.cargoCrates){
      if (c.loaded) continue;
      const s = worldToScreen(c.x, c.y);
      ctx.save();
      // Spawn bounce/pop-in: ease alpha and scale over spawnAnimMs
      let scale = 1, a = 1;
      if (c.spawnAt){
        const t = Math.max(0, Math.min(1, (now - c.spawnAt) / (CONFIG.crate.spawnAnimMs||700)));
        // Overshoot scale: 0.7 -> 1.06 -> 1.0
        const easeIn = t*t*(3 - 2*t);
        const overshoot = 1.06;
        const base = 0.7 + 0.3*easeIn;
        scale = base + (overshoot - base) * Math.sin(Math.min(1, t)*Math.PI*0.5);
        a = 0.1 + 0.9*t;
        c.alpha = a;
        if (t >= 1 && !c.glintUntil){ c.glintUntil = now + (CONFIG.crate.glintMs||900); }
      }
      ctx.globalAlpha = c.alpha;
      const dw = c.w * scale, dh = c.h * scale;
      const x = s.x - dw/2, y = s.y - dh/2;
      // body
      ctx.fillStyle = CONFIG.crate.color;
      ctx.fillRect(x, y, dw, dh);
      // stroke
      if (CONFIG.crate.stroke){ ctx.strokeStyle = CONFIG.crate.stroke; ctx.lineWidth = 2; ctx.strokeRect(x+0.5, y+0.5, dw-1, dh-1); }
      // glistening sheen sweep shortly after spawn
      if (c.glintUntil && now <= c.glintUntil){
        const left = (c.glintUntil - now) / (CONFIG.crate.glintMs||900);
        const t2 = 1 - Math.max(0, Math.min(1, left));
        const w = dw * 0.28; // stripe width
        const gx = x - w + (dw + w*2) * t2; // sweep across with slight overrun
        const grad = ctx.createLinearGradient(gx, y, gx + w, y + dh);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, `rgba(255,255,255,${CONFIG.crate.glintAlpha||0.22})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, dw, dh);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }

  /* ---------------------- LOGISTICS: TRUCK ----------------------- */
  function startTruckCycle(){
    const t = state.truck; if (t.inTransit) return; t.inTransit = true; t.tState = 'depart'; t.t0 = performance.now(); t._outTargetX = null; t._crossed = false;
  }

  function updateTruck(dt){
    const t = state.truck; if (!t) return;
    // Carrying crate following
    updateCratesFollow();
    // State machine
    if (!t.inTransit) return;
    const laneY = state.baseH * CONFIG.truck.laneYFrac; t.y = laneY - t.h/2;
    const speed = t.speed;
    const boundary = state.zoneBoundaryX;
    const rightEdge = state.baseW - 40;
    switch(t.tState){
      case 'depart':
        // compute an out target ~70% into Zone 2, clamped to world edge
        t._outTargetX = Math.min(rightEdge - t.w, boundary + Math.max(120, (state.baseW - boundary - t.w) * 0.7));
        t.tState = 'moveOut'; break;
      case 'moveOut':
        t.x += speed * dt;
        // boundary crossing cue
        if (!t._crossed && (t.x + t.w*0.5) >= boundary){ tick(); t._crossed = true; }
        if (t.x >= (t._outTargetX ?? (boundary + 60))){ t.tState = 'pause'; t.t0 = performance.now(); }
        break;
      case 'pause':
        if ((performance.now() - t.t0) >= CONFIG.truck.pauseMs){ t.tState = 'unload'; t.t0 = performance.now(); }
        break;
      case 'unload':
        // fade loaded crates out
        for (const slot of t.slots){ const c = state.cargoCrates.find(k=>k.id===slot.id); if (c) c.alpha = Math.max(0, c.alpha - dt*2); }
        if ((performance.now() - t.t0) >= 900){
          // remove unloaded crates
          state.cargoCrates = state.cargoCrates.filter(k=>!t.slots.some(s=>s.id===k.id));
          t.delivered = CONFIG.truck.slots;
          t.tState = 'return';
        }
        break;
      case 'return':
        t.x -= speed * dt;
        if (t.x <= boundary + CONFIG.truck.parkOffsetX){ t.tState = 'arrive'; }
        break;
      case 'arrive':
        t.inTransit = false; t.tState = 'parked';
        // shipment complete
        state.zone2Inventory += t.delivered; t.delivered = 0; t.slots = []; t.speed += CONFIG.truck.speedGain;
        toast('Shipment dispatched to Zone 2 (+3)', 'ok');
        try { document.dispatchEvent(new CustomEvent('shipmentComplete', { detail: { count: CONFIG.truck.slots, inventory: state.zone2Inventory } })); } catch{}
        break;
    }
  }

  function drawTruck(ctx){
    const t = state.truck; if (!t) return;
    const s = worldToScreen(t.x, t.y);
    const bob = Math.sin(performance.now()/300) * (CONFIG.truck.bobAmp);
    ctx.save();
    ctx.fillStyle = '#3a4a5f';
    ctx.fillRect(s.x, s.y + bob, t.w, t.h);
    // slots
    ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2;
    for (let i=0;i<CONFIG.truck.slots;i++){
      const dx = 20 + i*(CONFIG.crate.w + 10); const dy = 10;
      ctx.strokeRect(s.x + dx, s.y + dy + bob, CONFIG.crate.w, CONFIG.crate.h);
    }
    // loaded crates drawn on truck
    for (const slot of t.slots){
      const c = state.cargoCrates.find(k=>k.id===slot.id); if (!c) continue;
      ctx.save();
      ctx.globalAlpha = c.alpha;
      const x = s.x + slot.dx, y = s.y + slot.dy + bob, w = CONFIG.crate.w, h = CONFIG.crate.h;
      ctx.fillStyle = CONFIG.crate.color; ctx.fillRect(x, y, w, h);
      if (CONFIG.crate.stroke){ ctx.strokeStyle = CONFIG.crate.stroke; ctx.lineWidth = 2; ctx.strokeRect(x+0.5, y+0.5, w-1, h-1); }
      ctx.restore();
    }
    ctx.restore();
  }

  function updateLogistics(dt){ updateTruck(dt); }
  function drawLogistics(ctx){ drawTruck(ctx); drawCrates(ctx); }

  /* -------------------------- BOOTSTRAP -------------------------- */
  loadImages();
})();
