/* ===========================================================
   Mojave Refinery — MVP (Phase 0/1)
   Two canvas worlds with pan/zoom, parallax, spawners, and drag/assign.
   No libraries. Lots of comments for clarity/extension.
   =========================================================== */

/* ---------- DOM ---------- */
const els = {
  housingCanvas: document.getElementById('housingCanvas'),
  aircraftCanvas: document.getElementById('aircraftCanvas'),
  familiesWaiting: document.getElementById('familiesWaiting'),
  planesWaiting: document.getElementById('planesWaiting'),
  housesFilled: document.getElementById('housesFilled'),
  housesTotal: document.getElementById('housesTotal'),
  padsUsed: document.getElementById('padsUsed'),
  padsTotal: document.getElementById('padsTotal'),
  day: document.getElementById('day'),
  endDayBtn: document.getElementById('endDayBtn'),
  summary: document.getElementById('summary'),
  summaryBody: document.getElementById('summaryBody'),
  closeSummary: document.getElementById('closeSummary'),
};

/* ---------- Helpers ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Assets ---------- */
const Assets = {
  aircraftPlan: null,
};
// Load aircraft plan image
{
  const img = new Image();
  const path = 'assets/mojavebase.jpg';
  img.src = encodeURI(path);
  img.onerror = () => console.warn('Failed to load aircraft plan image:', path, 'requested as', img.src);
  Assets.aircraftPlan = img;
}

/* ---------- Camera (per world) ---------- */
class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.scale = 1;            // zoom
    this.minScale = 0.5;
    this.maxScale = 2.5;
    this.targetScale = 1;      // smoothed zoom target
  }
  worldToScreen(wx, wy) { return { x: (wx - this.x) * this.scale, y: (wy - this.y) * this.scale }; }
  screenToWorld(sx, sy) { return { x: sx / this.scale + this.x, y: sy / this.scale + this.y }; }
}

/* ---------- Base World ---------- */
class World {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 2000;           // world width (virtual)
    this.h = 1400;           // world height
    this.camera = new Camera();
    this.layers = opts.layers || []; // parallax: [{color|draw(ctx)}, speed]
    this.entities = [];
    this.slots = [];         // assign targets (houses/pads)
    // input
    this.draggingPan = false;
    this.draggingEntity = null;
    this.dragOffset = {x:0,y:0};
    this.lastMouse = {x:0,y:0};
    this.hoverEntity = null;

    // Smooth zoom state
    this.zoom = {
      active: false,
      anchorScreen: { x: 0, y: 0 }, // in device pixels
      anchorWorld:  { x: 0, y: 0 },
    };

    // Pan inertia
    this.panVX = 0; // world units per second
    this.panVY = 0;

    // bind events
    this._bindInput();
  }

  // Clamp camera position to current world extents (helper)
  _clampCamera() {
    const cam = this.camera;
    const viewW = (this.canvas.width / devicePixelRatio) / cam.scale;
    const viewH = (this.canvas.height / devicePixelRatio) / cam.scale;
    if (viewW >= this.w) {
      cam.x = (this.w - viewW) / 2;
    } else {
      cam.x = clamp(cam.x, 0, Math.max(0, this.w - viewW));
    }
    if (viewH >= this.h) {
      cam.y = (this.h - viewH) / 2;
    } else {
      cam.y = clamp(cam.y, 0, Math.max(0, this.h - viewH));
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(640, Math.floor(rect.width * devicePixelRatio));
    this.canvas.height = Math.max(480, Math.floor(rect.height * devicePixelRatio));
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  _bindInput() {
    const c = this.canvas;

    c.addEventListener('mousedown', (e) => {
      const p = this._mouseWorld(e);
      // Check if clicked an entity
      const ent = this._hitTest(p.x, p.y);
      if (ent) {
        this.draggingEntity = ent;
        this.dragOffset.x = p.x - ent.x;
        this.dragOffset.y = p.y - ent.y;
      } else {
        this.draggingPan = true;
        this.lastMouse = {x: e.clientX, y: e.clientY};
        // Reset inertial velocity at the start of a new drag
        this.panVX = 0; this.panVY = 0;
      }
      c.style.cursor = ent ? 'grabbing' : 'grabbing';
    });

    window.addEventListener('mouseup', () => {
      if (this.draggingEntity) {
        // Try to drop to nearest vacant slot
        const slot = this._nearestVacantSlot(this.draggingEntity.x, this.draggingEntity.y);
        if (slot && !slot.occupied && this._dist(slot.x, slot.y, this.draggingEntity.x, this.draggingEntity.y) < 90) {
          slot.occupied = true;
          this.onAssigned && this.onAssigned(this.draggingEntity, slot);
          // remove entity from world
          this.entities = this.entities.filter(e => e !== this.draggingEntity);
        }
      }
      this.draggingEntity = null;
      this.draggingPan = false;
      this.canvas.style.cursor = 'default';
    });

    window.addEventListener('mousemove', (e) => {
      if (this.draggingPan) {
        const dx = (e.clientX - this.lastMouse.x) / this.camera.scale;
        const dy = (e.clientY - this.lastMouse.y) / this.camera.scale;
        this.camera.x -= dx;
        this.camera.y -= dy;
        // Estimate velocity (world units per second)
        const vFactor = 60; // approximate 60fps
        this.panVX = -dx * vFactor;
        this.panVY = -dy * vFactor;
        this.lastMouse = {x:e.clientX,y:e.clientY};
        return;
      }
      if (this.draggingEntity) {
        const p = this._mouseWorld(e);
        this.draggingEntity.x = p.x - this.dragOffset.x;
        this.draggingEntity.y = p.y - this.dragOffset.y;
        return;
      }
      // hover
      const p = this._mouseWorld(e);
      this.hoverEntity = this._hitTest(p.x, p.y);
      this.canvas.style.cursor = this.hoverEntity ? 'grab' : 'default';
    });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Screen position in device pixels
      const rect = c.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * devicePixelRatio;
      const sy = (e.clientY - rect.top)  * devicePixelRatio;

      // Current mouse world point (as zoom anchor)
      const anchorW = this.camera.screenToWorld(sx, sy);

      // Adjust target scale with gentle intensity for smoother feel
      const intensity = 0.0012; // smaller = gentler
      const factor = Math.exp(-e.deltaY * intensity);
      this.camera.targetScale = clamp(
        this.camera.targetScale * factor,
        this.camera.minScale,
        this.camera.maxScale
      );

      // Store anchor so smoothing keeps cursor focus stable
      this.zoom.active = true;
      this.zoom.anchorScreen.x = sx;
      this.zoom.anchorScreen.y = sy;
      this.zoom.anchorWorld.x = anchorW.x;
      this.zoom.anchorWorld.y = anchorW.y;
    }, { passive: false });
  }

  _mouseWorld(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * devicePixelRatio;
    const sy = (e.clientY - rect.top)  * devicePixelRatio;
    return this.camera.screenToWorld(sx, sy);
  }

  _hitTest(x, y) {
    // simple hit by radius
    for (let i=this.entities.length-1; i>=0; i--) {
      const e = this.entities[i];
      if (this._dist(x,y, e.x, e.y) <= e.r) return e;
    }
    return null;
  }

  _nearestVacantSlot(x,y) {
    let best = null, bestD = Infinity;
    for (const s of this.slots) {
      if (s.occupied) continue;
      const d = this._dist(x,y, s.x, s.y);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }
  _dist(a,b,c,d){ const dx=a-c, dy=b-d; return Math.hypot(dx,dy); }

  update(dt) {
    // Smooth zoom step towards targetScale (exponential damping)
    const cam = this.camera;
    // Ensure targetScale respects current min/max before smoothing so we never approach an out-of-bounds scale
    cam.targetScale = clamp(cam.targetScale, cam.minScale, cam.maxScale);
    if (Math.abs(cam.targetScale - cam.scale) > 1e-4) {
      const k = 12; // responsiveness (per second)
      const t = 1 - Math.exp(-k * dt);
      cam.scale += (cam.targetScale - cam.scale) * t;

      // Keep the zoom anchor under the same screen position
      const as = this.zoom.anchorScreen; // device px
      const aw = this.zoom.anchorWorld;  // world coords
      cam.x = aw.x - as.x / cam.scale;
      cam.y = aw.y - as.y / cam.scale;
      // Clamp scale to hard min/max in case interpolation produced a tiny undershoot
      cam.scale = clamp(cam.scale, cam.minScale, cam.maxScale);
      // clamp immediately after adjusting camera to avoid showing empty space mid-zoom
      this._clampCamera();
    }

    // Apply pan inertia
    if (!this.draggingPan) {
      cam.x += this.panVX * dt;
      cam.y += this.panVY * dt;
      // Damping per second -> map to dt
      const damp = 0.85; // lower = more damping
      const d = Math.pow(damp, dt * 60);
      this.panVX *= d;
      this.panVY *= d;
      if (Math.abs(this.panVX) < 1e-3) this.panVX = 0;
      if (Math.abs(this.panVY) < 1e-3) this.panVY = 0;
    }

    // Clamp camera to world bounds so you can't pan past the image/world edges
    // Compute view size in world units
    const viewW = (this.canvas.width / devicePixelRatio) / cam.scale;
    const viewH = (this.canvas.height / devicePixelRatio) / cam.scale;
  // Ensure scale still respects bounds before computing view extents
  cam.scale = clamp(cam.scale, cam.minScale, cam.maxScale);
    if (viewW >= this.w) {
      // center horizontally
      cam.x = (this.w - viewW) / 2;
    } else {
      cam.x = clamp(cam.x, 0, Math.max(0, this.w - viewW));
    }
    if (viewH >= this.h) {
      // center vertically
      cam.y = (this.h - viewH) / 2;
    } else {
      cam.y = clamp(cam.y, 0, Math.max(0, this.h - viewH));
    }

    // basic idle wobble for waiting entities
    for (const e of this.entities) {
      e.idleT += dt;
      e.y += Math.sin(e.idleT * 3) * 0.15; // tiny bob
    }
  }

  draw() {
    const ctx = this.ctx, cam = this.camera;
    // clear
    ctx.clearRect(0,0,this.canvas.width, this.canvas.height);

    // camera
    ctx.save();
    ctx.scale(cam.scale, cam.scale);
    ctx.translate(-cam.x, -cam.y);

    // parallax backgrounds
    for (const L of this.layers) {
      if (typeof L.draw === 'function') {
        L.draw(ctx, cam, this.w, this.h);
      } else {
        ctx.fillStyle = L.color || '#111';
        ctx.fillRect(cam.x-10000, cam.y-10000, 20000, 20000);
      }
    }

    // slots
    for (const s of this.slots) {
      ctx.fillStyle = s.occupied ? 'rgba(60,180,90,.85)' : 'rgba(255,255,255,.08)';
      ctx.strokeStyle = s.occupied ? 'rgba(60,180,90,1)' : 'rgba(255,255,255,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    }

    // entities
    for (const e of this.entities) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI*2);
      ctx.fillStyle = e.type === 'family' ? '#2b6ff0' : '#f0a52b';
      ctx.fill();
      if (e === this.hoverEntity) {
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke();
      }
    }

    // dragging ghost to nearest slot
    if (this.draggingEntity) {
      const nearest = this._nearestVacantSlot(this.draggingEntity.x, this.draggingEntity.y);
      if (nearest) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.beginPath(); ctx.arc(nearest.x, nearest.y, nearest.r+4, 0, Math.PI*2);
        ctx.fillStyle = 'yellow'; ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  }
}

/* ---------- Specializations ---------- */
class HousingWorld extends World {
  constructor(canvas) {
    super(canvas, {
      layers: [
        { // deep background
          draw: (ctx, cam, W, H) => {
            ctx.fillStyle = '#0b1219'; ctx.fillRect(cam.x-20000, cam.y-20000, 40000, 40000);
            // skyline stripes
            ctx.fillStyle = '#0f1823';
            for (let i=0;i<8;i++){
              ctx.fillRect(-2000 + i*400, H*0.4, 300, 400);
            }
          }
        },
        { // ground
          draw: (ctx, cam, W, H) => {
            ctx.fillStyle = '#0e161f'; ctx.fillRect(-5000, H*0.75, 10000, 600);
          }
        },
      ]
    });

  // Camera starting pose
  this.camera.x = 250; this.camera.y = 500; this.camera.scale = 1;

    // Event on assigned
    this.onAssigned = (ent, slot) => {
      // fill a house
      Game.housesFilled++;
      updateHUD();
    };
  }
}

class AircraftWorld extends World {
  constructor(canvas) {
    super(canvas, {
      layers: [
        { // aircraft plan image as full-world background
          draw: (ctx, cam, W, H) => {
            const img = Assets.aircraftPlan;
            if (img && img.complete && img.naturalWidth) {
              // draw image to cover the entire world extents
              ctx.drawImage(img, 0, 0, W, H);
            } else {
              // fallback background while image loads
              ctx.fillStyle = '#071018'; ctx.fillRect(0, 0, W, H);
            }
          }
        },
        { // sky (only draw when no aircraft plan image)
          draw: (ctx, cam, W, H) => {
            const img = Assets.aircraftPlan;
            if (img && img.complete && img.naturalWidth) return; // plan covers background
            const g = ctx.createLinearGradient(0, cam.y, 0, cam.y+H);
            g.addColorStop(0, '#0b1930'); g.addColorStop(1, '#0a1420');
            ctx.fillStyle = g; ctx.fillRect(cam.x-20000, cam.y-20000, 40000, 40000);
            // stars
            ctx.fillStyle = 'rgba(255,255,255,.08)';
            for (let i=0;i<120;i++){
              const x = (i*240) % (W*4), y = 120 + (i*57)% (H*0.5);
              ctx.fillRect(x, y, 2, 2);
            }
          }
        },
        { // desert floor (skip if plan image is present)
          draw: (ctx, cam, W, H) => {
            const img = Assets.aircraftPlan;
            if (img && img.complete && img.naturalWidth) return;
            ctx.fillStyle = '#0c1218';
            ctx.fillRect(-5000, H*0.7, 10000, 800);
          }
        },
      ]
    });


    // Helper: build pad slots relative to current world extents
    // Uses percentages so pads align with the plan artwork when the image defines world size
    this._buildPads = function() {
      this.slots = [];
      const rows = 2, cols = 6;
      // pad radius scales with world size
      const R = Math.max(18, Math.min(48, Math.round(Math.min(this.w, this.h) * 0.02)));
      // anchor roughly where hangars appear in the plan (approx 48% width, 52% height)
      const anchorX = Math.round(this.w * 0.48);
      const anchorY = Math.round(this.h * 0.52);
      const gapX = Math.round(this.w * 0.06);
      const gapY = Math.round(this.h * 0.08);
      const startX = anchorX - Math.floor((cols-1) * gapX / 2);
      const startY = anchorY - Math.floor((rows-1) * gapY / 2);
      for (let r=0; r<rows; r++) {
        for (let c=0; c<cols; c++) {
          this.slots.push({ x: startX + c*gapX, y: startY + r*gapY, r: R, occupied:false, kind:'pad' });
        }
      }
    };

    // Camera starting pose
  this.camera.x = 900; this.camera.y = 520; this.camera.scale = 1;
  // allow deeper zoom into the aircraft plan
  this.camera.maxScale = 8.0;

    // If the aircraft plan image has loaded, make the world extents match it.
    const planImg = Assets.aircraftPlan;
    if (planImg && planImg.complete && planImg.naturalWidth) {
      this.w = planImg.naturalWidth;
      this.h = planImg.naturalHeight;
      // Fit image into the canvas view initially
  const rect = this.canvas.getBoundingClientRect();
  const fitScale = Math.min(rect.width / this.w, rect.height / this.h) || 1;
  this.camera.scale = this.camera.targetScale = fitScale;
  // prevent zooming out beyond the image extents
  this.camera.minScale = fitScale;
  this.camera.x = 0;
  this.camera.y = 0;
      // Rebuild pad locations now that world extents match the image
      this._buildPads();
    } else if (planImg) {
      planImg.addEventListener('load', () => {
        this.w = planImg.naturalWidth;
        this.h = planImg.naturalHeight;
  const rect = this.canvas.getBoundingClientRect();
  const fitScale = Math.min(rect.width / this.w, rect.height / this.h) || 1;
  this.camera.scale = this.camera.targetScale = fitScale;
  // prevent zooming out beyond the image extents
  this.camera.minScale = fitScale;
  this.camera.x = 0;
  this.camera.y = 0;
        // Resize canvas since world size changed (optional visual consistency)
  this.resize();
        // Rebuild pad locations to align with the loaded image
        this._buildPads();
      });
    }

      // Recompute fit minScale on resize so user cannot zoom out past image after window size change
      const origResize = this.resize.bind(this);
      this.resize = () => {
        origResize();
        const img = Assets.aircraftPlan;
        if (img && img.complete && img.naturalWidth) {
          const rect = this.canvas.getBoundingClientRect();
          const fitScale = Math.min(rect.width / this.w, rect.height / this.h) || 1;
          this.camera.minScale = fitScale;
          if (this.camera.scale < fitScale) {
            this.camera.scale = this.camera.targetScale = fitScale;
          }
        }
      };

    // Note: `_buildPads` will create default pads based on current world size.

    // Assigned plane → pad
    this.onAssigned = (ent, slot) => {
      Game.padsUsed++;
      updateHUD();
    };
  }
}

/* ---------- Global Game State ---------- */
const Game = {
  day: 1,
  housing: null,
  aircraft: null,
  // counts
  familiesWaiting: 0,
  planesWaiting: 0,
  housesFilled: 0,
  padsUsed: 0,
  get housesTotal(){ return Game.housing?.slots.length || 0; },
  get padsTotal(){ return Game.aircraft?.slots.length || 0; },
  // spawners timers
  spawnT_family: 0,
  spawnT_plane: 0,
};

/* ---------- Init ---------- */
function init() {
  Game.housing = new HousingWorld(els.housingCanvas);
  Game.aircraft = new AircraftWorld(els.aircraftCanvas);
  Officer.init();
  onResize();
  window.addEventListener('resize', onResize);

  // End day
  els.endDayBtn.addEventListener('click', endDay);
  els.closeSummary.addEventListener('click', () => {
    els.summary.classList.add('hidden');
    Game.day++;
    updateHUD();
  });

  // Start loop
  lastTS = performance.now();
  requestAnimationFrame(loop);

  updateHUD();
}

function onResize(){
  Game.housing.resize();
  Game.aircraft.resize();
}

/* ---------- Spawners ---------- */
function spawnFamily() {
  // spawn near left edge region
  const e = { type:'family', x: 80 + Math.random()*120, y: 800 + Math.random()*200, r: 18, idleT: Math.random()*10 };
  Game.housing.entities.push(e);
  Game.familiesWaiting++;
}

function spawnPlane() {
  // spawn near right incoming strip
  const e = { type:'plane', x: 1700 + Math.random()*120, y: 760 + Math.random()*140, r: 22, idleT: Math.random()*10 };
  Game.aircraft.entities.push(e);
  Game.planesWaiting++;
}

/* ---------- End of Day Summary ---------- */
function endDay(){
  // Count still waiting
  const fWaiting = Game.housing.entities.filter(e=>e.type==='family').length;
  const pWaiting = Game.aircraft.entities.filter(e=>e.type==='plane').length;

  const text = `
    <p>Families housed today: <b>${Game.housesFilled}</b></p>
    <p>Families still waiting: <b>${fWaiting}</b></p>
    <hr style="border:0;border-top:1px solid #1d2530;margin:10px 0;">
    <p>Planes parked today: <b>${Game.padsUsed}</b></p>
    <p>Planes still waiting: <b>${pWaiting}</b></p>
    <p style="opacity:.7;margin-top:10px">In the next phases we’ll add costs, stress, policy events, and the Mojave Refinery build path.</p>
  `;
  els.summaryBody.innerHTML = text;
  els.summary.classList.remove('hidden');

  // soft daily reset of counters
  Game.housesFilled = 0;
  Game.padsUsed = 0;
  Game.familiesWaiting = fWaiting;
  Game.planesWaiting = pWaiting;
  updateHUD();
}

/* ---------- Loop ---------- */
let lastTS = 0;
function loop(ts){
  const dt = Math.min(0.035, (ts - lastTS)/1000); // clamp dt for stability
  lastTS = ts;

  // spawn
  Game.spawnT_family += dt;
  Game.spawnT_plane  += dt;
  if (Game.spawnT_family > 1.75) { Game.spawnT_family = 0; spawnFamily(); updateHUD(); }
  if (Game.spawnT_plane  > 2.25) { Game.spawnT_plane  = 0; spawnPlane();  updateHUD(); }

  // update
  Game.housing.update(dt);
  Game.aircraft.update(dt);
  Officer.update(dt);

  // If a slot was occupied this frame (handled in World.onAssigned),
  // we must decrement waiting counts.
  // We'll recompute waiting from entity arrays each HUD update instead
  // to avoid edge mistakes.

  // draw
  Game.housing.draw();
  Game.aircraft.draw();

  requestAnimationFrame(loop);
}

/* ---------- HUD ---------- */
function updateHUD(){
  const fams = Game.housing.entities.filter(e=>e.type==='family').length;
  const planes= Game.aircraft.entities.filter(e=>e.type==='plane').length;
  Game.familiesWaiting = fams;
  Game.planesWaiting = planes;

  els.day.textContent = Game.day;
  els.familiesWaiting.textContent = Game.familiesWaiting;
  els.planesWaiting.textContent = Game.planesWaiting;

  els.housesFilled.textContent = Game.housesFilled;
  els.housesTotal.textContent = Game.housesTotal;

  els.padsUsed.textContent = Game.padsUsed;
  els.padsTotal.textContent = Game.padsTotal;
}

/* ---------- Officer (office NPC) ---------- */
const Officer = {
  el: null,
  square: null,
  x: 160,
  y: 260,
  vx: 0,
  vy: 0,
  targetX: 160,
  targetY: 260,
  retargetT: 0,
  squareRect: null,
  mouseIn: false,
  mouseX: 160,
  mouseY: 160,

  init() {
    this.el = document.getElementById('officer');
    this.square = document.getElementById('officeSquare');
    this.cacheSquareBounds();
    this.randomizeTarget();
    this.updatePosition();

    window.addEventListener('resize', () => this.cacheSquareBounds());

    // Global mouse tracking: follow mouse anywhere EXCEPT when inside the office square
    window.addEventListener('mousemove', (e) => {
      const r = this.squareRect || this.square.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      this.mouseIn = inside;
      // Convert global mouse to square-local coordinates for consistent targeting
      this.mouseX = clamp(e.clientX - r.left, 0, r.width);
      this.mouseY = clamp(e.clientY - r.top, 0, r.height);
    });
  },

  cacheSquareBounds() {
    this.squareRect = this.square.getBoundingClientRect();
  },

  randomizeTarget() {
    const margin = 16;
    const w = 320; // square width
    const h = 320; // square height
    this.targetX = margin + Math.random() * (w - margin * 2);
    this.targetY = margin + Math.random() * (h - margin * 2);
  },

  update(dt) {
    // Retarget less frequently: every 3–6s for more intentional movement
    this.retargetT -= dt;
    if (this.retargetT <= 0) {
      this.retargetT = 3.0 + Math.random() * 3.0;
      this.randomizeTarget();
    }

    // Blend attraction: mouse (when inside) + random target
  // If mouse is OUTSIDE the office square, follow the mouse; otherwise, wander only
  const mx = !this.mouseIn ? this.mouseX : this.targetX;
  const my = !this.mouseIn ? this.mouseY : this.targetY;
  const mix = !this.mouseIn ? 0.35 : 0.0; // gentler mouse attraction
    const tx = mx * mix + this.targetX * (1 - mix);
    const ty = my * mix + this.targetY * (1 - mix);

    // Velocity towards blended target (reduced acceleration)
    const ax = (tx - this.x) * 1.0;
    const ay = (ty - this.y) * 1.0;
    this.vx += ax * dt;
    this.vy += ay * dt;

    // Stronger damping for slower, intentional movement
    this.vx *= 0.87;
    this.vy *= 0.87;

    // Cap max speed (px/sec) to avoid sudden darts
    const maxSpeed = 60; // tune 40–80
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      this.vx *= s; this.vy *= s;
    }

    // Integrate (normalize to look similar across FPS)
    this.x += this.vx * dt * 60;
    this.y += this.vy * dt * 60;

    // Confine to square bounds
    const margin = 12;
    this.x = clamp(this.x, margin, 320 - margin);
    this.y = clamp(this.y, margin, 320 - margin);

    this.updatePosition();
  },

  updatePosition() {
    if (!this.el) return;
    // Center the officer element (22x34) around x,y
    this.el.style.left = `${this.x - 11}px`;
    this.el.style.top  = `${this.y - 17}px`;
  }
};

// Optional: simple API to control layering
function setOfficerInFront(isFront = true) {
  const sq = document.getElementById('officeSquare');
  if (!sq) return;
  sq.classList.toggle('front', !!isFront);
  sq.classList.toggle('behind', !isFront);
}

/* ---------- Boot ---------- */
init();
