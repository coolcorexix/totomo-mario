import './style.css';
import * as mp from './multiplayer';

// ---------- Canvas setup ----------

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const scoreEl = document.querySelector<HTMLSpanElement>('#score')!;
const heartsEl = document.querySelector<HTMLDivElement>('#hearts')!;
const expFillEl = document.querySelector<HTMLDivElement>('#exp-fill')!;
const parryChipEl = document.querySelector<HTMLDivElement>('#parry-chip')!;
const dashChipEl = document.querySelector<HTMLDivElement>('#dash-chip')!;
const jump2ChipEl = document.querySelector<HTMLDivElement>('#jump2-chip')!;
const glideChipEl = document.querySelector<HTMLDivElement>('#glide-chip')!;
const hintEl = document.querySelector<HTMLDivElement>('#hint')!;
const onlineCountEl = document.querySelector<HTMLSpanElement>('#online-count')!;

let width = 0;
let height = 0;
let dpr = 1;
let groundY = 0; // ground height at the horizontal center of the curve

// the world is the surface of a huge circle (a "little planet"): the ground
// dips away from center toward the edges, and gravity pulls slightly toward
// this circle's center rather than straight down
let planetRadius = 3200;
let planetCenterX = 0;

function groundYAt(x: number): number {
  const dx = x - planetCenterX;
  return groundY + (dx * dx) / (2 * planetRadius);
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  groundY = height - 64;
  planetCenterX = width / 2;
  planetRadius = width * 2.2;
}

window.addEventListener('resize', resize);

// ---------- Palette ----------

const PALETTE = {
  skyTop: '#4a2f8a',
  skyBottom: '#8a4fc9',
  ground: '#2f7a4f',
  groundEdge: '#245f3d',
  player: '#ff5a5f',
  playerDark: '#d8383d',
  playerEye: '#1a1a1a',
  coin: '#FFD23F',
  coinEdge: '#E8A400',
  obstacle: '#78716c',
  obstacleEdge: '#44403c',
  platform: '#c98a4f',
  platformTop: '#e6ac72',
  platformEdge: '#7a4b28',
};

const BURST_COLORS = ['#ff5a5f', '#FFD23F', '#4ade80', '#38bdf8', '#f472b6'];

// ---------- Input ----------

const keys = new Set<string>();
let hintShown = true;

function markInput() {
  if (hintShown) {
    hintShown = false;
    hintEl.classList.add('hidden');
  }
  ensureAudio();
}

window.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
    e.preventDefault();
  }
  keys.add(e.key.toLowerCase());
  markInput();
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
});

function isDown(...names: string[]) {
  return names.some((n) => keys.has(n));
}

// ---------- Audio ----------
// the play field doubles as an 88-key piano: a collected coin's x picks the
// key, so grabbing coins plays as a loose melody. Meteors hit like a kick
// drum instead, giving the shower its own rhythm section.

const PIANO_LOW_MIDI = 21; // A0
const PIANO_KEY_COUNT = 88; // ends at C8 (108)

let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext | null {
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

function xToMidiNote(x: number): number {
  const t = Math.max(0, Math.min(1, x / width));
  return Math.round(PIANO_LOW_MIDI + t * (PIANO_KEY_COUNT - 1));
}

function applyEcho(ctxA: AudioContext, source: AudioNode, wetLevel = 0.5) {
  const delay = ctxA.createDelay(1);
  delay.delayTime.value = 0.22;
  const feedback = ctxA.createGain();
  feedback.gain.value = 0.35;
  const wet = ctxA.createGain();
  wet.gain.value = wetLevel;

  source.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(ctxA.destination);

  setTimeout(() => {
    try {
      source.disconnect(delay);
      delay.disconnect();
      feedback.disconnect();
      wet.disconnect();
    } catch {
      /* nodes may already be gone */
    }
  }, 1800);
}

function playPianoNote(x: number, velocity = 1) {
  const ctxA = ensureAudio();
  if (!ctxA) return;
  const note = xToMidiNote(x);
  const freq = midiToFreq(note);
  const now = ctxA.currentTime;

  // fundamentals below ~C3 are barely reproduced by small speakers, so
  // boost gain and lean harder on the upper harmonics as notes get lower
  const lowness = Math.max(0, Math.min(1, (48 - note) / 27)); // 0 at C3, 1 at A0
  const peak = 0.24 * velocity * (1 + lowness * 1.4);

  const osc = ctxA.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const gain = ctxA.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
  osc.connect(gain).connect(ctxA.destination);
  applyEcho(ctxA, gain, 0.4);

  const overtone = ctxA.createOscillator();
  overtone.type = 'sine';
  overtone.frequency.value = freq * 2;
  const overtoneGain = ctxA.createGain();
  overtoneGain.gain.setValueAtTime(0, now);
  overtoneGain.gain.linearRampToValueAtTime(peak * (0.16 + lowness * 0.32), now + 0.006);
  overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  overtone.connect(overtoneGain).connect(ctxA.destination);

  osc.start(now);
  overtone.start(now);
  osc.stop(now + 1.15);
  overtone.stop(now + 0.5);

  if (lowness > 0) {
    // an extra octave-up voice so the lowest keys still have audible
    // presence even when the fundamental itself falls below hearing range
    const shimmer = ctxA.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = freq * 4;
    const shimmerGain = ctxA.createGain();
    shimmerGain.gain.setValueAtTime(0, now);
    shimmerGain.gain.linearRampToValueAtTime(peak * 0.22 * lowness, now + 0.006);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    shimmer.connect(shimmerGain).connect(ctxA.destination);
    shimmer.start(now);
    shimmer.stop(now + 0.4);
  }
}

function playKickSound(velocity = 1) {
  const ctxA = ensureAudio();
  if (!ctxA) return;
  const now = ctxA.currentTime;
  const peak = 0.8 * (0.6 + 0.4 * velocity);

  const thump = ctxA.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(150, now);
  thump.frequency.exponentialRampToValueAtTime(38, now + 0.16);
  const thumpGain = ctxA.createGain();
  thumpGain.gain.setValueAtTime(peak, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  thump.connect(thumpGain).connect(ctxA.destination);

  const click = ctxA.createOscillator();
  click.type = 'square';
  click.frequency.value = 900;
  const clickGain = ctxA.createGain();
  clickGain.gain.setValueAtTime(peak * 0.3, now);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
  click.connect(clickGain).connect(ctxA.destination);

  // low rumbling tremor bed under the thump, amplitude-wobbled so the
  // impact reads as a shaking ground rumble rather than a dull thud
  const rumble = ctxA.createOscillator();
  rumble.type = 'sawtooth';
  rumble.frequency.setValueAtTime(65, now);
  rumble.frequency.exponentialRampToValueAtTime(48, now + 0.4);
  const rumbleGain = ctxA.createGain();
  rumbleGain.gain.setValueAtTime(peak * 0.55, now);
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);

  const tremor = ctxA.createOscillator();
  tremor.type = 'sine';
  tremor.frequency.value = 19; // shaky, growly modulation rate
  const tremorDepth = ctxA.createGain();
  tremorDepth.gain.value = peak * 0.4;
  tremor.connect(tremorDepth);
  tremorDepth.connect(rumbleGain.gain);

  const rumbleFilter = ctxA.createBiquadFilter();
  rumbleFilter.type = 'lowpass';
  rumbleFilter.frequency.value = 220;
  rumble.connect(rumbleFilter).connect(rumbleGain).connect(ctxA.destination);

  thump.start(now);
  click.start(now);
  rumble.start(now);
  tremor.start(now);
  thump.stop(now + 0.26);
  click.stop(now + 0.03);
  rumble.stop(now + 0.44);
  tremor.stop(now + 0.44);
}

function playParrySound() {
  const ctxA = ensureAudio();
  if (!ctxA) return;
  const now = ctxA.currentTime;
  const peak = 0.5;

  const bell = ctxA.createOscillator();
  bell.type = 'square';
  bell.frequency.setValueAtTime(1400, now);
  bell.frequency.exponentialRampToValueAtTime(900, now + 0.12);
  const bellGain = ctxA.createGain();
  bellGain.gain.setValueAtTime(peak, now);
  bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  bell.connect(bellGain).connect(ctxA.destination);
  applyEcho(ctxA, bellGain, 0.3);

  const shimmer = ctxA.createOscillator();
  shimmer.type = 'sine';
  shimmer.frequency.value = 2200;
  const shimmerGain = ctxA.createGain();
  shimmerGain.gain.setValueAtTime(peak * 0.4, now);
  shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  shimmer.connect(shimmerGain).connect(ctxA.destination);

  bell.start(now);
  shimmer.start(now);
  bell.stop(now + 0.3);
  shimmer.stop(now + 0.42);
}

// ---------- Particles ----------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
}

const particles: Particle[] = [];

function spawnBurst(
  x: number,
  y: number,
  count: number,
  opts: Partial<{ speed: number; colors: string[]; gravity: number; size: number }> = {},
) {
  const speed = opts.speed ?? 260;
  const colors = opts.colors ?? BURST_COLORS;
  const gravity = opts.gravity ?? 900;
  const baseSize = opts.size ?? 5;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const spd = speed * (0.4 + Math.random() * 0.9);
    const life = 0.35 + Math.random() * 0.35;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 80,
      life,
      maxLife: life,
      size: baseSize * (0.6 + Math.random() * 0.8),
      color: colors[Math.floor(Math.random() * colors.length)],
      gravity,
    });
  }
}

function updateParticles(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function drawParticles() {
  for (const p of particles) {
    const t = p.life / p.maxLife;
    ctx.globalAlpha = t;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------- Floating score popups ----------

interface Popup {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text: string;
}

const popups: Popup[] = [];

function spawnPopup(x: number, y: number, text: string) {
  popups.push({ x, y, life: 0.7, maxLife: 0.7, text });
}

function updatePopups(dt: number) {
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.life -= dt;
    p.y -= 60 * dt;
    if (p.life <= 0) popups.splice(i, 1);
  }
}

function drawPopups() {
  ctx.font = '800 20px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const p of popups) {
    const t = p.life / p.maxLife;
    ctx.globalAlpha = t;
    ctx.fillStyle = '#FFD23F';
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

// ---------- Screen shake ----------

let shakeTime = 0;
let shakeMag = 0;

function triggerShake(mag: number, duration: number) {
  shakeMag = Math.max(shakeMag, mag);
  shakeTime = Math.max(shakeTime, duration);
}

function updateShake(dt: number) {
  if (shakeTime > 0) {
    shakeTime -= dt;
    if (shakeTime <= 0) {
      shakeTime = 0;
      shakeMag = 0;
    }
  }
}

// ---------- Slow motion ----------

const SLOWMO_DURATION = 0.35;
const SLOWMO_SCALE = 0.25;

let slowMoTimer = 0;

function triggerSlowMo() {
  slowMoTimer = SLOWMO_DURATION;
}

// ---------- Player ----------

const PLAYER_W = 44;
const PLAYER_H = 48;
const MOVE_SPEED = 340;
const GRAVITY = 2100;
const JUMP_VELOCITY = -820;
const MAX_JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

// shape-unlocked abilities, gated on the permanent heartBonus (highest shape
// stage ever reached) rather than the live/fluctuating score-based stage
const DASH_SPEED = 900;
const DASH_DURATION = 0.18;
const DASH_COOLDOWN = 0.9;
const AIR_JUMP_VELOCITY_MULT = 0.82;
const GLIDE_MAX_FALL_SPEED = 110;
const GLIDE_GRAVITY_MULT = 0.12;

// a gentle sideways nudge toward the planet's center, standing in for the
// horizontal component of gravity on a curved surface
const PLANET_PULL_RATE = 0.12;

function planetPullAt(x: number): number {
  return -(x - planetCenterX) * PLANET_PULL_RATE;
}

// parry is a base mechanic available from the start, not shape-gated: a
// well-timed press right as a hazard connects negates the hit and pays out
const PARRY_WINDOW = 0.18;
const PARRY_COOLDOWN = 0.6;
const PARRY_BONUS = 2;

// consecutive parries build a combo that pays out more, but the combo
// itself decays if you go too long between successful parries
const PARRY_COMBO_WINDOW = 3.5;
const PARRY_COMBO_BONUS_CAP = 8;

let parryCombo = 0;
let parryComboTimer = 0;

function updateParryCombo(dt: number) {
  if (parryCombo <= 0) return;
  parryComboTimer -= dt;
  if (parryComboTimer <= 0) {
    parryCombo = 0;
    parryComboTimer = 0;
  }
}

const player = {
  x: 0,
  y: 0, // feet height above ground (0 = grounded)
  vx: 0,
  vy: 0,
  onGround: true,
  surface: null as Platform | null, // platform currently stood on, null = ground
  facing: 1,
  squashX: 1,
  squashY: 1,
  hitFlash: 0,
  hitCooldown: 0,
  dashTime: 0,
  dashCooldown: 0,
  airJumpsRemaining: 0,
  parryTime: 0,
  parryCooldown: 0,
};

let jumpKeyHeld = false;
let dashKeyHeld = false;
let parryKeyHeld = false;

function resetPlayer() {
  player.x = width / 2;
  player.y = 0;
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
  player.surface = null;
  player.hitFlash = 0;
  player.hitCooldown = 0;
  player.dashTime = 0;
  player.dashCooldown = 0;
  player.airJumpsRemaining = 0;
  player.parryTime = 0;
  player.parryCooldown = 0;
}

function updatePlayer(dt: number) {
  if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt);
  if (player.hitCooldown > 0) player.hitCooldown = Math.max(0, player.hitCooldown - dt);
  if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - dt);
  if (player.parryCooldown > 0) player.parryCooldown = Math.max(0, player.parryCooldown - dt);
  if (player.parryTime > 0) player.parryTime = Math.max(0, player.parryTime - dt);

  const wantsParry = isDown('control', 'x');
  const parryPressed = wantsParry && !parryKeyHeld;
  parryKeyHeld = wantsParry;

  if (parryPressed && player.parryCooldown <= 0 && player.parryTime <= 0) {
    player.parryTime = PARRY_WINDOW;
    player.parryCooldown = PARRY_COOLDOWN;
    spawnBurst(player.x, groundYAt(player.x) - (player.y + PLAYER_H / 2), 8, {
      speed: 140,
      colors: ['#38bdf8', '#ffffff'],
      gravity: 0,
      size: 3,
    });
  }

  const canDash = heartBonus >= 1;
  const canDoubleJump = heartBonus >= 2;
  const canGlide = heartBonus >= 3;

  const wantsDash = canDash && isDown('shift');
  const dashPressed = wantsDash && !dashKeyHeld;
  dashKeyHeld = wantsDash;

  if (dashPressed && player.dashCooldown <= 0 && player.dashTime <= 0) {
    player.dashTime = DASH_DURATION;
    player.dashCooldown = DASH_COOLDOWN;
    player.hitCooldown = Math.max(player.hitCooldown, DASH_DURATION + 0.05);
    spawnBurst(player.x, groundYAt(player.x) - (player.y + PLAYER_H / 2), 14, {
      speed: 240,
      colors: [STAGE_1.fill, '#ffffff'],
      gravity: 0,
      size: 4,
    });
  }

  if (player.dashTime > 0) player.dashTime = Math.max(0, player.dashTime - dt);

  let moveInput = 0;
  if (isDown('arrowleft', 'a')) moveInput -= 1;
  if (isDown('arrowright', 'd')) moveInput += 1;

  if (player.dashTime > 0) {
    player.vx = DASH_SPEED * player.facing * statMultiplier;
    if (Math.random() < 0.6) {
      spawnBurst(player.x - player.facing * 12, groundYAt(player.x) - (player.y + PLAYER_H / 2), 1, {
        speed: 40,
        colors: ['#ffffff', STAGE_1.fill],
        gravity: 0,
        size: 3,
      });
    }
  } else {
    player.vx = moveInput * MOVE_SPEED * statMultiplier + planetPullAt(player.x);
    if (moveInput !== 0) player.facing = moveInput > 0 ? 1 : -1;
  }

  player.x += player.vx * dt;
  player.x = Math.max(PLAYER_W / 2 + 12, Math.min(width - PLAYER_W / 2 - 12, player.x));

  // walked off the edge of the platform we were standing on
  if (player.onGround && player.surface && !surfaceContainsX(player.surface, player.x)) {
    player.onGround = false;
  }

  const wantsJump = isDown('arrowup', 'w', ' ');
  const jumpPressed = wantsJump && !jumpKeyHeld;
  jumpKeyHeld = wantsJump;

  if (jumpPressed && player.onGround) {
    player.vy = JUMP_VELOCITY * statMultiplier;
    player.onGround = false;
    spawnBurst(player.x, groundYAt(player.x) - player.y, 10, {
      speed: 200,
      colors: ['#ffffff', '#d7d7ff'],
      gravity: 600,
      size: 4,
    });
    player.squashY = 1.35;
    player.squashX = 0.75;
  } else if (jumpPressed && !player.onGround && canDoubleJump && player.airJumpsRemaining > 0) {
    player.airJumpsRemaining -= 1;
    player.vy = JUMP_VELOCITY * AIR_JUMP_VELOCITY_MULT * statMultiplier;
    spawnBurst(player.x, groundYAt(player.x) - (player.y + PLAYER_H / 2), 12, {
      speed: 220,
      colors: [STAGE_2.fill, '#ffffff'],
      gravity: 500,
      size: 4,
    });
    player.squashY = 1.3;
    player.squashX = 0.8;
  }

  const wasOnGround = player.onGround;

  if (!player.onGround) {
    const gliding = canGlide && player.vy > 0 && isDown(' ');
    if (gliding) {
      player.vy = Math.min(player.vy + GRAVITY * dt * GLIDE_GRAVITY_MULT, GLIDE_MAX_FALL_SPEED);
      if (Math.random() < 0.35) {
        spawnBurst(player.x, groundYAt(player.x) - (player.y + PLAYER_H / 2), 1, {
          speed: 50,
          colors: [STAGE_3.fill, '#ffffff'],
          gravity: -60,
          size: 3,
        });
      }
    } else {
      player.vy += GRAVITY * dt;
    }
  }

  const oldY = player.y;
  const newY = oldY - player.vy * dt;

  let landed = false;
  if (player.vy >= 0) {
    const landing = findLanding(oldY, newY, player.x);
    if (landing) {
      if (!wasOnGround) {
        spawnBurst(player.x, groundYAt(player.x) - landing.y, 8, {
          speed: 160,
          colors: ['#ffffff', '#d7d7ff'],
          gravity: 700,
          size: 4,
        });
        player.squashY = 0.7;
        player.squashX = 1.3;
      }
      player.y = landing.y;
      player.vy = 0;
      player.onGround = true;
      player.surface = landing.platform;
      player.airJumpsRemaining = canDoubleJump ? 1 : 0;
      landed = true;
    }
  }

  if (!landed) {
    player.y = Math.max(0, newY);
  }

  const targetY = player.onGround ? 1 : player.vy < 0 ? 1.12 : 0.94;
  const targetX = player.onGround ? 1 : player.vy < 0 ? 0.9 : 1.05;
  player.squashY += (targetY - player.squashY) * Math.min(1, dt * 14);
  player.squashX += (targetX - player.squashX) * Math.min(1, dt * 14);
}

interface PlayerStage {
  index: number;
  minScore: number;
  scale: number;
  cornerRadius: number;
  fill: string;
  stroke: string;
  accessory: 'none' | 'ears' | 'spikes' | 'halo';
}

const STAGE_0: PlayerStage = {
  index: 0,
  minScore: 0,
  scale: 1,
  cornerRadius: 14,
  fill: PALETTE.player,
  stroke: PALETTE.playerDark,
  accessory: 'none',
};
const STAGE_1: PlayerStage = {
  index: 1,
  minScore: 10,
  scale: 1.15,
  cornerRadius: 20,
  fill: '#4ade80',
  stroke: '#2f9e56',
  accessory: 'ears',
};
const STAGE_2: PlayerStage = {
  index: 2,
  minScore: 25,
  scale: 1.3,
  cornerRadius: 24,
  fill: '#38bdf8',
  stroke: '#1d7fae',
  accessory: 'spikes',
};
const STAGE_3: PlayerStage = {
  index: 3,
  minScore: 50,
  scale: 1.5,
  cornerRadius: 28,
  fill: '#f472b6',
  stroke: '#c23e82',
  accessory: 'halo',
};

const PLAYER_STAGES = [STAGE_3, STAGE_2, STAGE_1, STAGE_0];
const PLAYER_STAGES_ASC = [STAGE_0, STAGE_1, STAGE_2, STAGE_3];

function getPlayerStage(score: number): PlayerStage {
  for (const stage of PLAYER_STAGES) {
    if (score >= stage.minScore) return stage;
  }
  return STAGE_0;
}

function getNextStage(stage: PlayerStage): PlayerStage | null {
  const idx = PLAYER_STAGES_ASC.findIndex((s) => s.index === stage.index);
  return idx >= 0 && idx < PLAYER_STAGES_ASC.length - 1 ? PLAYER_STAGES_ASC[idx + 1] : null;
}

// ---------- Health & progression ----------
// score doubles as the EXP bar (current stage progress); hearts and the
// speed/jump stat boost are permanent rewards for the highest stage ever
// reached, so they don't regress if score later drops.

const BASE_HEARTS = 3;
const STAT_BOOST_PER_STAGE = 0.08;

let heartBonus = 0;
let maxHearts = BASE_HEARTS;
let hearts = BASE_HEARTS;
let statMultiplier = 1;

function renderHearts() {
  heartsEl.innerHTML = '';
  for (let i = 0; i < maxHearts; i++) {
    const span = document.createElement('span');
    span.className = i < hearts ? 'heart' : 'heart empty';
    span.textContent = '♥';
    heartsEl.appendChild(span);
  }
}

function renderExpBar() {
  const stage = getPlayerStage(score);
  const next = getNextStage(stage);
  let pct = 1;
  if (next) {
    const span = next.minScore - stage.minScore;
    pct = span > 0 ? (score - stage.minScore) / span : 1;
  }
  expFillEl.style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
}

function updateAbilityChips() {
  dashChipEl.classList.toggle('hidden', heartBonus < 1);
  jump2ChipEl.classList.toggle('hidden', heartBonus < 2);
  glideChipEl.classList.toggle('hidden', heartBonus < 3);
}

function applyStageBonus(stage: PlayerStage) {
  if (stage.index <= heartBonus) return;
  heartBonus = stage.index;
  maxHearts = BASE_HEARTS + heartBonus;
  hearts = maxHearts;
  statMultiplier = 1 + heartBonus * STAT_BOOST_PER_STAGE;
  renderHearts();
  updateAbilityChips();
}

function loseHeart() {
  hearts = Math.max(0, hearts - 1);
  renderHearts();
  if (hearts <= 0) {
    score = 0;
    heartBonus = 0;
    maxHearts = BASE_HEARTS;
    hearts = BASE_HEARTS;
    statMultiplier = 1;
    parryCombo = 0;
    parryComboTimer = 0;
    scoreEl.textContent = '0';
    renderHearts();
    renderExpBar();
    updateAbilityChips();
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlayerAccessory(stage: PlayerStage, w: number, h: number) {
  if (stage.accessory === 'none') return;

  ctx.fillStyle = stage.fill;
  ctx.strokeStyle = stage.stroke;
  ctx.lineWidth = 2.5;

  if (stage.accessory === 'ears') {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * w * 0.32, -h / 2 + 4);
      ctx.lineTo(side * w * 0.44, -h / 2 - 12);
      ctx.lineTo(side * w * 0.2, -h / 2 - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (stage.accessory === 'spikes') {
    const spikeCount = 3;
    const spikeW = w / spikeCount;
    for (let i = 0; i < spikeCount; i++) {
      const baseX = -w / 2 + spikeW * i;
      ctx.beginPath();
      ctx.moveTo(baseX, -h / 2 + 2);
      ctx.lineTo(baseX + spikeW / 2, -h / 2 - 16);
      ctx.lineTo(baseX + spikeW, -h / 2 + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (stage.accessory === 'halo') {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#FFD23F';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -h / 2 - 14, w * 0.34, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawCharacterBody(
  w: number,
  h: number,
  stage: PlayerStage,
  fill: string,
  stroke: string,
  facing: number,
  hitFlash: number,
) {
  if (hitFlash > 0) ctx.filter = 'invert(1)';

  drawPlayerAccessory({ ...stage, fill, stroke }, w, h);

  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  roundRect(-w / 2, -h / 2, w, h, stage.cornerRadius);
  ctx.fill();
  ctx.stroke();

  const eyeOffsetX = facing * w * 0.16;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(eyeOffsetX - 2, -h * 0.08, 8, 0, Math.PI * 2);
  ctx.arc(eyeOffsetX + 14, -h * 0.08, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.playerEye;
  ctx.beginPath();
  ctx.arc(eyeOffsetX - 2 + facing * 2, -h * 0.08, 3.5, 0, Math.PI * 2);
  ctx.arc(eyeOffsetX + 14 + facing * 2, -h * 0.08, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.filter = 'none';
}

function drawCharacterShadow(cx: number, yHeight: number, scale: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#000000';
  const shadowScale = Math.max(0.35, 1 - yHeight / MAX_JUMP_HEIGHT) * scale;
  ctx.beginPath();
  ctx.ellipse(cx, groundYAt(cx), 22 * shadowScale, 7 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const stage = getPlayerStage(score);
  const screenY = groundYAt(player.x) - player.y;
  const w = PLAYER_W * player.squashX * stage.scale;
  const h = PLAYER_H * player.squashY * stage.scale;
  const cx = player.x;
  const cy = screenY - h / 2;

  drawCharacterShadow(cx, player.y, stage.scale, Math.max(0.12, 0.32 - player.y / 500));

  ctx.save();
  ctx.translate(cx, cy);
  drawCharacterBody(w, h, stage, stage.fill, stage.stroke, player.facing, player.hitFlash);
  ctx.restore();
}

function drawParryGlow() {
  if (player.parryTime <= 0) return;
  const t = player.parryTime / PARRY_WINDOW;
  const stage = getPlayerStage(score);
  const screenY = groundYAt(player.x) - player.y - (PLAYER_H * stage.scale) / 2;
  ctx.save();
  ctx.globalAlpha = 0.55 * t;
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(player.x, screenY, (PLAYER_W * stage.scale) * 0.75 + (1 - t) * 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRemotePlayers() {
  for (const p of mp.getRemotePlayers()) {
    const stage = getPlayerStage(p.score);
    const px = p.x * width;
    const screenY = groundYAt(px) - p.y;
    const w = PLAYER_W * p.squashX * stage.scale;
    const h = PLAYER_H * p.squashY * stage.scale;
    const cy = screenY - h / 2;

    ctx.globalAlpha = 0.88;
    drawCharacterShadow(px, p.y, stage.scale, Math.max(0.1, 0.28 - p.y / 500));

    ctx.save();
    ctx.translate(px, cy);
    drawCharacterBody(w, h, stage, p.color, '#1a1a1a', p.facing, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ---------- Coins ----------

interface Coin {
  id: string;
  x: number;
  y: number; // height above ground
  bob: number;
  spin: number;
}

const COIN_COUNT = 3;
const COIN_RADIUS = 16;
const coins: Coin[] = [];

function randomId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;
}

function randomCoinPosition(): { x: number; y: number } {
  const margin = 50;
  const x = margin + Math.random() * (width - margin * 2);
  // must sit above the standing player's reach so a jump is required
  const minY = PLAYER_H / 2 + COIN_RADIUS + 30;
  const maxY = Math.min(MAX_JUMP_HEIGHT * 0.85, height - 160);
  const y = minY + Math.random() * Math.max(20, maxY - minY);
  return { x, y };
}

function spawnCoin(): Coin {
  const { x, y } = randomCoinPosition();
  return { id: randomId(), x, y, bob: Math.random() * Math.PI * 2, spin: 0 };
}

function applyRemoteCoin(removedId: string, payload: mp.CoinPayload) {
  const idx = coins.findIndex((c) => c.id === removedId);
  if (idx !== -1) coins.splice(idx, 1);
  if (!coins.some((c) => c.id === payload.id)) {
    coins.push({
      id: payload.id,
      x: payload.x * width,
      y: payload.y,
      bob: Math.random() * Math.PI * 2,
      spin: 0,
    });
  }
}

function initCoins() {
  coins.length = 0;
  for (let i = 0; i < COIN_COUNT; i++) coins.push(spawnCoin());
}

function updateCoins(dt: number) {
  for (const c of coins) {
    c.bob += dt * 2.4;
    c.spin += dt * 3.2;
  }
}

function drawCoins() {
  for (const c of coins) {
    const screenY = groundYAt(c.x) - c.y - Math.sin(c.bob) * 6;
    const scaleX = Math.abs(Math.cos(c.spin));
    ctx.save();
    ctx.translate(c.x, screenY);
    ctx.scale(Math.max(0.15, scaleX), 1);
    ctx.fillStyle = PALETTE.coin;
    ctx.strokeStyle = PALETTE.coinEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, COIN_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function triggerTransformation() {
  const screenY = groundYAt(player.x) - (player.y + PLAYER_H / 2);
  spawnBurst(player.x, screenY, 36, {
    speed: 420,
    colors: [STAGE_0.fill, STAGE_1.fill, STAGE_2.fill, STAGE_3.fill, '#ffffff', PALETTE.coin],
    gravity: 380,
    size: 7,
  });
  triggerShake(14, 0.35);
}

function collectCoin(index: number, screenX: number, screenY: number) {
  const prevStage = getPlayerStage(score);
  const removedId = coins[index].id;
  coins.splice(index, 1);
  const newCoin = spawnCoin();
  coins.push(newCoin);
  mp.broadcastCoinCollected(removedId, { id: newCoin.id, x: newCoin.x / width, y: newCoin.y });
  score += 1;
  scoreEl.textContent = String(score);
  renderExpBar();
  playPianoNote(screenX, 0.8);
  spawnBurst(screenX, screenY, 16, {
    speed: 320,
    colors: [PALETTE.coin, PALETTE.coinEdge, '#ffffff'],
    gravity: 500,
    size: 5,
  });
  spawnPopup(screenX, screenY - 10, '+1');
  triggerShake(6, 0.18);

  const newStage = getPlayerStage(score);
  if (newStage.index !== prevStage.index) {
    triggerTransformation();
    applyStageBonus(newStage);
  }
}

function checkCoinCollisions() {
  const playerCenterY = player.y + PLAYER_H / 2;
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    const dx = player.x - c.x;
    const dy = playerCenterY - c.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < COIN_RADIUS + PLAYER_W * 0.32) {
      collectCoin(i, c.x, groundYAt(c.x) - c.y);
    }
  }
}

// ---------- Floating platforms ----------

interface Platform {
  x: number; // center x
  y: number; // height above ground of the top surface
  w: number;
  hp: number;
  maxHp: number;
}

interface PendingRespawn {
  timer: number;
}

const PLATFORM_H = 20;
const PLATFORM_HP = 3;
const PLATFORM_RESPAWN_MIN = 4;
const PLATFORM_RESPAWN_MAX = 7;

const platforms: Platform[] = [];
const pendingRespawns: PendingRespawn[] = [];

function surfaceContainsX(p: Platform, x: number): boolean {
  const halfW = p.w / 2;
  return x >= p.x - halfW && x <= p.x + halfW;
}

// finds the highest surface (platform or ground) the player crossed while
// falling from oldY to newY at the given x; returns null if none crossed.
function findLanding(
  oldY: number,
  newY: number,
  x: number,
): { y: number; platform: Platform | null } | null {
  let best: { y: number; platform: Platform | null } | null = null;
  for (const p of platforms) {
    if (!surfaceContainsX(p, x)) continue;
    if (p.y <= oldY + 0.5 && p.y >= newY - 0.5) {
      if (!best || p.y > best.y) best = { y: p.y, platform: p };
    }
  }
  if (0 <= oldY + 0.5 && 0 >= newY - 0.5) {
    if (!best || 0 > best.y) best = { y: 0, platform: null };
  }
  return best;
}

function initPlatforms() {
  platforms.length = 0;
  const margin = 90;
  const stepCount = 5 + Math.floor(Math.random() * 3); // 5-7 platforms
  let x = margin + Math.random() * (width - margin * 2);
  let y = 90 + Math.random() * 40;
  let dir = Math.random() < 0.5 ? 1 : -1;

  for (let i = 0; i < stepCount; i++) {
    const w = 100 + Math.random() * 70;
    platforms.push({ x, y, w, hp: PLATFORM_HP, maxHp: PLATFORM_HP });

    if (Math.random() < 0.35) dir *= -1;
    const dx = (110 + Math.random() * 90) * dir;
    let nx = x + dx;
    if (nx < margin || nx > width - margin) {
      dir *= -1;
      nx = x - dx;
    }
    nx = Math.max(margin, Math.min(width - margin, nx));

    const dy = 60 + Math.random() * 70;
    const ny = Math.min(y + dy, height - 160);

    x = nx;
    y = ny;
  }
}

function drawPlatforms() {
  for (const p of platforms) {
    const screenY = groundYAt(p.x) - p.y;
    const damage = 1 - p.hp / p.maxHp;
    ctx.save();
    ctx.fillStyle = PALETTE.platformEdge;
    ctx.fillRect(p.x - p.w / 2, screenY, p.w, PLATFORM_H);
    ctx.fillStyle = PALETTE.platform;
    ctx.fillRect(p.x - p.w / 2, screenY, p.w, PLATFORM_H - 6);
    ctx.fillStyle = PALETTE.platformTop;
    ctx.fillRect(p.x - p.w / 2, screenY, p.w, 4);

    if (damage > 0) {
      const cracks = p.maxHp - p.hp;
      ctx.strokeStyle = 'rgba(30, 16, 6, 0.65)';
      ctx.lineWidth = 2;
      for (let i = 0; i < cracks; i++) {
        const cx = p.x - p.w / 2 + ((i + 1) / (cracks + 1)) * p.w;
        ctx.beginPath();
        ctx.moveTo(cx - 5, screenY + 2);
        ctx.lineTo(cx + 3, screenY + PLATFORM_H / 2);
        ctx.lineTo(cx - 4, screenY + PLATFORM_H - 3);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

function damagePlatform(p: Platform) {
  p.hp -= 1;
  spawnBurst(p.x, groundYAt(p.x) - p.y, 10, {
    speed: 200,
    colors: [PALETTE.platformEdge, PALETTE.platform, '#ffffff'],
    gravity: 500,
    size: 5,
  });
  if (p.hp <= 0) {
    destroyPlatform(p);
  } else {
    triggerShake(4, 0.15);
  }
}

function destroyPlatform(p: Platform) {
  const idx = platforms.indexOf(p);
  if (idx !== -1) platforms.splice(idx, 1);
  spawnBurst(p.x, groundYAt(p.x) - p.y, 20, {
    speed: 260,
    colors: [PALETTE.platformEdge, PALETTE.platform, '#8f5c2e'],
    gravity: 650,
    size: 6,
  });
  triggerShake(9, 0.25);
  if (player.surface === p) {
    player.onGround = false;
    player.surface = null;
  }
  pendingRespawns.push({ timer: PLATFORM_RESPAWN_MIN + Math.random() * (PLATFORM_RESPAWN_MAX - PLATFORM_RESPAWN_MIN) });
}

function spawnReplacementPlatform() {
  const margin = 90;
  let anchorX: number;
  let anchorY: number;
  if (platforms.length > 0 && Math.random() < 0.7) {
    const a = platforms[Math.floor(Math.random() * platforms.length)];
    anchorX = a.x;
    anchorY = a.y;
  } else {
    anchorX = margin + Math.random() * (width - margin * 2);
    anchorY = 0;
  }
  const dir = Math.random() < 0.5 ? 1 : -1;
  const x = Math.max(margin, Math.min(width - margin, anchorX + dir * (110 + Math.random() * 90)));
  const y = Math.min(anchorY + 60 + Math.random() * 70, height - 160);
  const w = 100 + Math.random() * 70;
  platforms.push({ x, y, w, hp: PLATFORM_HP, maxHp: PLATFORM_HP });
}

function updatePlatformRespawns(dt: number) {
  for (let i = pendingRespawns.length - 1; i >= 0; i--) {
    pendingRespawns[i].timer -= dt;
    if (pendingRespawns[i].timer <= 0) {
      pendingRespawns.splice(i, 1);
      spawnReplacementPlatform();
    }
  }
}

// ---------- Hit handling ----------

function applyHitPenalty(knockDir: number) {
  player.x = Math.max(
    PLAYER_W / 2 + 12,
    Math.min(width - PLAYER_W / 2 - 12, player.x + knockDir * 34),
  );
  if (player.onGround) {
    player.vy = JUMP_VELOCITY * 0.45;
    player.onGround = false;
  }
  player.hitFlash = 0.3;
  player.hitCooldown = 0.5;

  const screenY = groundYAt(player.x) - (player.y + PLAYER_H / 2);
  spawnBurst(player.x, screenY, 12, {
    speed: 260,
    colors: [PALETTE.obstacle, PALETTE.obstacleEdge, '#ffffff'],
    gravity: 700,
    size: 5,
  });
  triggerShake(8, 0.22);

  loseHeart();
}

function handleParrySuccess(screenX: number, screenY: number) {
  player.parryTime = 0;
  player.hitCooldown = Math.max(player.hitCooldown, 0.25);

  parryCombo += 1;
  parryComboTimer = PARRY_COMBO_WINDOW;
  const bonus = PARRY_BONUS + Math.min(parryCombo - 1, PARRY_COMBO_BONUS_CAP);

  const prevStage = getPlayerStage(score);
  score += bonus;
  scoreEl.textContent = String(score);
  renderExpBar();
  spawnPopup(screenX, screenY - 10, parryCombo > 1 ? `PARRY +${bonus} x${parryCombo}` : `PARRY +${bonus}`);
  spawnBurst(screenX, screenY, 22, {
    speed: 380,
    colors: ['#ffffff', '#FFD23F', '#38bdf8'],
    gravity: 200,
    size: 6,
  });
  triggerShake(10, 0.2);
  playParrySound();
  triggerSlowMo();

  const newStage = getPlayerStage(score);
  if (newStage.index !== prevStage.index) {
    triggerTransformation();
    applyStageBonus(newStage);
  }
}

// ---------- Meteor shower ----------
// a recurring dodge-focused set piece: telegraphed rocks rain from the sky
// in escalating waves, forcing constant movement, then the game returns to
// its calmer platforming/coin loop until the next shower.

interface Telegraph {
  x: number;
  timer: number;
  duration: number;
}

interface FallingObstacle {
  x: number;
  y: number; // screen y, falls downward from above the viewport
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  deflected: boolean; // parried: flying off harmlessly instead of falling
}

const SHOWER_BASE_DURATION = 10;
const SHOWER_DURATION_GROWTH = 1.2; // extra seconds of spawning per wave
const SHOWER_DURATION_GROWTH_CAP = 8; // seconds, so waves don't spawn forever
const SHOWER_GAP_MIN = 16;
const SHOWER_GAP_MAX = 26;

const FALL_SPEED_MIN_BASE = 360;
const FALL_SPEED_MAX_BASE = 620;
const FALL_SPEED_WAVE_GROWTH = 0.09; // +9% fall speed per wave
const FALL_SPEED_WAVE_GROWTH_CAP = 10; // waves, so it caps around +90%

// meteors spawn on a musical beat grid instead of a random interval; tempo
// climbs with each wave, and subdivisions tighten as a wave progresses
const SHOWER_BPM_BASE = 96;
const SHOWER_BPM_WAVE_GROWTH = 6;
const SHOWER_BPM_CAP = 184;

const telegraphs: Telegraph[] = [];
const fallingObstacles: FallingObstacle[] = [];

let waveIndex = 0;

const shower = {
  active: false,
  wave: 0,
  duration: SHOWER_BASE_DURATION,
  elapsed: 0,
  timer: 0,
  spawnTimer: 0,
  calmTimer: 8 + Math.random() * 6,
  tookHit: false,
  announceTimer: 0,
  clearTimer: 0,
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function beatSeconds(): number {
  const bpm = Math.min(SHOWER_BPM_BASE + (shower.wave - 1) * SHOWER_BPM_WAVE_GROWTH, SHOWER_BPM_CAP);
  return 60 / bpm;
}

function startShower() {
  waveIndex += 1;
  shower.active = true;
  shower.wave = waveIndex;
  shower.duration =
    SHOWER_BASE_DURATION + Math.min((waveIndex - 1) * SHOWER_DURATION_GROWTH, SHOWER_DURATION_GROWTH_CAP);
  shower.elapsed = 0;
  shower.timer = shower.duration;
  shower.spawnTimer = 0.3;
  shower.tookHit = false;
  shower.announceTimer = 2.2;
  triggerShake(6, 0.3);
}

function awardShowerBonus() {
  const bonus = 3;
  const prevStage = getPlayerStage(score);
  score += bonus;
  scoreEl.textContent = String(score);
  renderExpBar();
  spawnPopup(player.x, groundYAt(player.x) - (player.y + PLAYER_H + 30), `+${bonus} dodge bonus`);
  const newStage = getPlayerStage(score);
  if (newStage.index !== prevStage.index) {
    triggerTransformation();
    applyStageBonus(newStage);
  }
}

function endShower() {
  shower.active = false;
  shower.calmTimer = SHOWER_GAP_MIN + Math.random() * (SHOWER_GAP_MAX - SHOWER_GAP_MIN);
  shower.clearTimer = 1.8;
  if (!shower.tookHit) awardShowerBonus();
}

function spawnTelegraph() {
  const margin = 50;
  const x = margin + Math.random() * (width - margin * 2);
  const progress = Math.min(1, shower.elapsed / shower.duration);
  const duration = lerp(0.75, 0.42, progress);
  telegraphs.push({ x, timer: duration, duration });
}

function spawnFallingObstacle(x: number) {
  const progress = Math.min(1, shower.elapsed / shower.duration);
  const waveSpeedMult = 1 + Math.min(shower.wave - 1, FALL_SPEED_WAVE_GROWTH_CAP) * FALL_SPEED_WAVE_GROWTH;
  const size = 16 + Math.random() * 14;
  const speed = lerp(FALL_SPEED_MIN_BASE, FALL_SPEED_MAX_BASE, progress) * waveSpeedMult * (0.85 + Math.random() * 0.3);
  fallingObstacles.push({
    x,
    y: -40,
    vx: 0,
    vy: speed,
    size,
    rotation: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 6,
    deflected: false,
  });
}

function updateShower(dt: number) {
  if (shower.announceTimer > 0) shower.announceTimer -= dt;
  if (shower.clearTimer > 0) shower.clearTimer -= dt;

  if (!shower.active) {
    shower.calmTimer -= dt;
    if (shower.calmTimer <= 0) startShower();
    return;
  }

  shower.elapsed += dt;
  shower.timer -= dt;
  shower.spawnTimer -= dt;

  const progress = Math.min(1, shower.elapsed / shower.duration);
  if (shower.timer > 0 && shower.spawnTimer <= 0) {
    spawnTelegraph();
    const subdivision = progress < 0.4 ? 1 : progress < 0.75 ? 0.5 : 0.25;
    shower.spawnTimer = beatSeconds() * subdivision;
  }

  if (shower.timer <= 0 && telegraphs.length === 0 && fallingObstacles.length === 0) {
    endShower();
  }
}

function updateTelegraphs(dt: number) {
  for (let i = telegraphs.length - 1; i >= 0; i--) {
    const t = telegraphs[i];
    t.timer -= dt;
    if (t.timer <= 0) {
      telegraphs.splice(i, 1);
      spawnFallingObstacle(t.x);
    }
  }
}

function updateFallingObstacles(dt: number) {
  for (let i = fallingObstacles.length - 1; i >= 0; i--) {
    const f = fallingObstacles[i];
    f.x += f.vx * dt;
    f.rotation += f.rotSpeed * dt;

    if (f.deflected) {
      f.vy += GRAVITY * 0.3 * dt;
      f.y += f.vy * dt;
      if (f.x < -60 || f.x > width + 60 || f.y > height + 60) {
        fallingObstacles.splice(i, 1);
      }
      continue;
    }

    const oldWorldY = groundYAt(f.x) - f.y;
    f.y += f.vy * dt;
    const newWorldY = groundYAt(f.x) - f.y;

    if (f.y - f.size > height) {
      fallingObstacles.splice(i, 1);
      continue;
    }

    const landing = findLanding(oldWorldY, newWorldY, f.x);
    if (landing) {
      spawnBurst(f.x, groundYAt(f.x) - landing.y, 10, {
        speed: 240,
        colors: [PALETTE.obstacle, PALETTE.obstacleEdge, '#f97316'],
        gravity: 650,
        size: 5,
      });
      if (landing.platform) damagePlatform(landing.platform);
      playKickSound(Math.min(1, f.vy / FALL_SPEED_MAX_BASE));
      fallingObstacles.splice(i, 1);
    }
  }
}

function hitFallingObstacle(f: FallingObstacle) {
  const dir = player.x <= f.x ? -1 : 1;
  applyHitPenalty(dir);
  if (shower.active) shower.tookHit = true;
}

function deflectFallingObstacle(f: FallingObstacle) {
  const dir = player.x <= f.x ? 1 : -1;
  f.deflected = true;
  f.vx = dir * 700;
  f.vy = -Math.abs(f.vy) * 0.6;
  f.rotSpeed *= 3;
}

function checkFallingObstacleCollisions() {
  if (player.hitCooldown > 0) return;
  const stage = getPlayerStage(score);
  const playerScreenY = groundYAt(player.x) - (player.y + (PLAYER_H * stage.scale) / 2);
  const halfW = (PLAYER_W * stage.scale) / 2 * 0.65;
  const halfH = (PLAYER_H * stage.scale) / 2 * 0.65;
  for (let i = fallingObstacles.length - 1; i >= 0; i--) {
    const f = fallingObstacles[i];
    if (f.deflected) continue;
    const dx = Math.abs(player.x - f.x);
    const dy = Math.abs(playerScreenY - f.y);
    if (dx < halfW + f.size * 0.7 && dy < halfH + f.size * 0.7) {
      if (player.parryTime > 0) {
        deflectFallingObstacle(f);
        handleParrySuccess(f.x, playerScreenY);
      } else {
        fallingObstacles.splice(i, 1);
        hitFallingObstacle(f);
      }
      return;
    }
  }
}

function drawTelegraphs() {
  for (const t of telegraphs) {
    const p = 1 - t.timer / t.duration;
    const pulse = 0.6 + 0.4 * Math.sin(p * Math.PI * 6);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ff5a5f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(t.x, 10);
    ctx.lineTo(t.x - 10, 26);
    ctx.lineTo(t.x + 10, 26);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.3 + 0.25 * pulse;
    ctx.fillStyle = '#ff5a5f';
    ctx.beginPath();
    ctx.ellipse(t.x, groundYAt(t.x), 26, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawFallingObstacles() {
  for (const f of fallingObstacles) {
    ctx.save();
    ctx.translate(f.x, f.y);

    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(-f.size * 0.3, -f.size * 2.4);
    ctx.lineTo(f.size * 0.3, -f.size * 2.4);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.rotate(f.rotation);
    ctx.fillStyle = PALETTE.obstacle;
    ctx.strokeStyle = PALETTE.obstacleEdge;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      const ang = (Math.PI * 2 * i) / spikes;
      const r = f.size * (i % 2 === 0 ? 1 : 0.7);
      const px = Math.cos(ang) * r;
      const py = Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawShowerUI() {
  if (shower.active) {
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.08 * Math.sin(performance.now() / 220);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(0, 0, width, 6);
    ctx.restore();
  }

  if (shower.announceTimer > 0) {
    const alpha =
      shower.announceTimer > 1.6
        ? Math.min(1, (2.2 - shower.announceTimer) / 0.6)
        : Math.min(1, shower.announceTimer / 0.6);
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = 'center';
    ctx.font = '800 32px system-ui, sans-serif';
    ctx.fillStyle = '#ff5a5f';
    ctx.fillText('METEOR SHOWER — DODGE!', width / 2, 90);
    ctx.restore();
  }

  if (shower.clearTimer > 0) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, shower.clearTimer / 0.6));
    ctx.textAlign = 'center';
    ctx.font = '800 24px system-ui, sans-serif';
    ctx.fillStyle = shower.tookHit ? '#FFD23F' : '#4ade80';
    ctx.fillText(shower.tookHit ? 'Shower cleared' : 'Perfect dodge!', width / 2, 90);
    ctx.restore();
  }
}


// ---------- Background ----------

const GROUND_CURVE_STEP = 24;

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(1, PALETTE.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, groundYAt(0));
  for (let x = 0; x <= width; x += GROUND_CURVE_STEP) {
    ctx.lineTo(x, groundYAt(x));
  }
  ctx.lineTo(width, groundYAt(width));
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fillStyle = PALETTE.groundEdge;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, groundYAt(0));
  for (let x = 0; x <= width; x += GROUND_CURVE_STEP) {
    ctx.lineTo(x, groundYAt(x));
  }
  ctx.strokeStyle = PALETTE.ground;
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ---------- Game loop ----------

let score = 0;
let lastTime = performance.now();

function frame(now: number) {
  const rawDt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  let dt = rawDt;
  if (slowMoTimer > 0) {
    dt = rawDt * SLOWMO_SCALE;
    slowMoTimer = Math.max(0, slowMoTimer - rawDt);
  }

  updatePlayer(dt);
  updateCoins(dt);
  updateShower(dt);
  updateTelegraphs(dt);
  updateFallingObstacles(dt);
  updatePlatformRespawns(dt);
  updateParryCombo(dt);
  updateParticles(dt);
  updatePopups(dt);
  updateShake(dt);
  mp.updateRemotePlayers(dt);
  checkCoinCollisions();
  checkFallingObstacleCollisions();

  parryChipEl.textContent = parryCombo > 1 ? `🛡 Parry ×${parryCombo}` : '🛡 Parry — Ctrl/X';
  parryChipEl.classList.toggle('cooling', player.parryCooldown > 0 && player.parryTime <= 0);
  parryChipEl.classList.toggle('active', player.parryTime > 0);
  if (heartBonus >= 1) dashChipEl.classList.toggle('cooling', player.dashCooldown > 0 || player.dashTime > 0);
  if (heartBonus >= 3) glideChipEl.classList.toggle('active', player.vy > 0 && !player.onGround && isDown(' '));

  mp.sendPlayerState({
    x: player.x / width,
    y: player.y,
    facing: player.facing,
    squashX: player.squashX,
    squashY: player.squashY,
    score,
  });
  const online = mp.onlineCount();
  if (onlineCountEl.textContent !== String(online)) {
    onlineCountEl.textContent = String(online);
  }

  ctx.save();
  if (shakeTime > 0) {
    const sx = (Math.random() - 0.5) * shakeMag;
    const sy = (Math.random() - 0.5) * shakeMag;
    ctx.translate(sx, sy);
  }

  drawBackground();
  drawPlatforms();
  drawTelegraphs();
  drawCoins();
  drawRemotePlayers();
  drawPlayer();
  drawParryGlow();
  drawFallingObstacles();
  drawParticles();
  drawPopups();
  drawShowerUI();

  ctx.restore();

  requestAnimationFrame(frame);
}

// ---------- Boot ----------

resize();
initPlatforms();
resetPlayer();
initCoins();
renderHearts();
renderExpBar();
updateAbilityChips();
mp.onCoinEvent(applyRemoteCoin);
mp.initMultiplayer();
requestAnimationFrame(frame);
