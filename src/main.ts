import './style.css';
import * as mp from './multiplayer';

// ---------- Canvas setup ----------

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const scoreEl = document.querySelector<HTMLSpanElement>('#score')!;
const hintEl = document.querySelector<HTMLDivElement>('#hint')!;
const onlineCountEl = document.querySelector<HTMLSpanElement>('#online-count')!;

let width = 0;
let height = 0;
let dpr = 1;
let groundY = 0;

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

// ---------- Player ----------

const PLAYER_W = 44;
const PLAYER_H = 48;
const MOVE_SPEED = 340;
const GRAVITY = 2100;
const JUMP_VELOCITY = -820;
const MAX_JUMP_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);

const player = {
  x: 0,
  y: 0, // feet height above ground (0 = grounded)
  vx: 0,
  vy: 0,
  onGround: true,
  facing: 1,
  squashX: 1,
  squashY: 1,
  hitFlash: 0,
  hitCooldown: 0,
};

function resetPlayer() {
  player.x = width / 2;
  player.y = 0;
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
  player.hitFlash = 0;
  player.hitCooldown = 0;
}

function updatePlayer(dt: number) {
  if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt);
  if (player.hitCooldown > 0) player.hitCooldown = Math.max(0, player.hitCooldown - dt);

  let moveInput = 0;
  if (isDown('arrowleft', 'a')) moveInput -= 1;
  if (isDown('arrowright', 'd')) moveInput += 1;

  player.vx = moveInput * MOVE_SPEED;
  if (moveInput !== 0) player.facing = moveInput > 0 ? 1 : -1;

  const wantsJump = isDown('arrowup', 'w', ' ');
  if (wantsJump && player.onGround) {
    player.vy = JUMP_VELOCITY;
    player.onGround = false;
    spawnBurst(player.x, groundY, 10, {
      speed: 200,
      colors: ['#ffffff', '#d7d7ff'],
      gravity: 600,
      size: 4,
    });
    player.squashY = 1.35;
    player.squashX = 0.75;
  }

  const wasOnGround = player.onGround;

  if (!player.onGround) {
    player.vy += GRAVITY * dt;
  }

  player.x += player.vx * dt;
  player.y -= player.vy * dt;

  player.x = Math.max(PLAYER_W / 2 + 12, Math.min(width - PLAYER_W / 2 - 12, player.x));

  if (player.y <= 0) {
    if (!wasOnGround) {
      spawnBurst(player.x, groundY, 8, {
        speed: 160,
        colors: ['#ffffff', '#d7d7ff'],
        gravity: 700,
        size: 4,
      });
      player.squashY = 0.7;
      player.squashX = 1.3;
    }
    player.y = 0;
    player.vy = 0;
    player.onGround = true;
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

function getPlayerStage(score: number): PlayerStage {
  for (const stage of PLAYER_STAGES) {
    if (score >= stage.minScore) return stage;
  }
  return STAGE_0;
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
  ctx.ellipse(cx, groundY, 22 * shadowScale, 7 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const stage = getPlayerStage(score);
  const screenY = groundY - player.y;
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

function drawRemotePlayers() {
  for (const p of mp.getRemotePlayers()) {
    const stage = getPlayerStage(p.score);
    const px = p.x * width;
    const screenY = groundY - p.y;
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
    const screenY = groundY - c.y - Math.sin(c.bob) * 6;
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
  const screenY = groundY - (player.y + PLAYER_H / 2);
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
      collectCoin(i, c.x, groundY - c.y);
    }
  }
}

// ---------- Obstacles ----------

interface Obstacle {
  baseX: number;
  x: number;
  phase: number;
  driftSpeed: number;
  driftRange: number;
}

const OBSTACLE_W = 30;
const OBSTACLE_H = 34;
const obstacles: Obstacle[] = [];
let obstacleTime = 0;

function randomObstacleBaseX(): number {
  const margin = 60;
  return margin + Math.random() * (width - margin * 2);
}

function spawnObstacle(): Obstacle {
  const baseX = randomObstacleBaseX();
  return {
    baseX,
    x: baseX,
    phase: Math.random() * Math.PI * 2,
    driftSpeed: 0.4 + Math.random() * 0.3,
    driftRange: 40 + Math.random() * 60,
  };
}

function initObstacles() {
  obstacles.length = 0;
  const count = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) obstacles.push(spawnObstacle());
}

function updateObstacles(dt: number) {
  obstacleTime += dt;
  const half = OBSTACLE_W / 2 + 10;
  for (const o of obstacles) {
    o.x = o.baseX + Math.sin(obstacleTime * o.driftSpeed + o.phase) * o.driftRange;
    o.x = Math.max(half, Math.min(width - half, o.x));
  }
}

function drawObstacles() {
  for (const o of obstacles) {
    ctx.save();
    ctx.translate(o.x, groundY);
    ctx.fillStyle = PALETTE.obstacle;
    ctx.strokeStyle = PALETTE.obstacleEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-OBSTACLE_W / 2, 0);
    ctx.lineTo(0, -OBSTACLE_H);
    ctx.lineTo(OBSTACLE_W / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function hitObstacle(o: Obstacle) {
  const dir = player.x <= o.x ? -1 : 1;
  player.x = Math.max(
    PLAYER_W / 2 + 12,
    Math.min(width - PLAYER_W / 2 - 12, player.x + dir * 34),
  );
  if (player.onGround) {
    player.vy = JUMP_VELOCITY * 0.45;
    player.onGround = false;
  }
  player.hitFlash = 0.3;
  player.hitCooldown = 0.5;

  const screenY = groundY - (player.y + PLAYER_H / 2);
  spawnBurst(player.x, screenY, 12, {
    speed: 260,
    colors: [PALETTE.obstacle, PALETTE.obstacleEdge, '#ffffff'],
    gravity: 700,
    size: 5,
  });
  triggerShake(8, 0.22);
}

function checkObstacleCollisions() {
  if (player.hitCooldown > 0) return;
  for (const o of obstacles) {
    const dx = Math.abs(player.x - o.x);
    const overlapsX = dx < OBSTACLE_W / 2 + PLAYER_W * 0.35;
    const overlapsY = player.y < OBSTACLE_H * 0.8;
    if (overlapsX && overlapsY) {
      hitObstacle(o);
      return;
    }
  }
}

// ---------- Background ----------

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(1, PALETTE.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = PALETTE.groundEdge;
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.fillStyle = PALETTE.ground;
  ctx.fillRect(0, groundY, width, 10);
}

// ---------- Game loop ----------

let score = 0;
let lastTime = performance.now();

function frame(now: number) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  updatePlayer(dt);
  updateCoins(dt);
  updateObstacles(dt);
  updateParticles(dt);
  updatePopups(dt);
  updateShake(dt);
  mp.updateRemotePlayers(dt);
  checkCoinCollisions();
  checkObstacleCollisions();

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
  drawObstacles();
  drawCoins();
  drawRemotePlayers();
  drawPlayer();
  drawParticles();
  drawPopups();

  ctx.restore();

  requestAnimationFrame(frame);
}

// ---------- Boot ----------

resize();
resetPlayer();
initCoins();
initObstacles();
mp.onCoinEvent(applyRemoteCoin);
mp.initMultiplayer();
requestAnimationFrame(frame);
