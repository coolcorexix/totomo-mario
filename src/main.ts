import './style.css';

// ---------- Canvas setup ----------

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ctx = canvas.getContext('2d')!;
const scoreEl = document.querySelector<HTMLSpanElement>('#score')!;
const hintEl = document.querySelector<HTMLDivElement>('#hint')!;

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
};

function resetPlayer() {
  player.x = width / 2;
  player.y = 0;
  player.vx = 0;
  player.vy = 0;
  player.onGround = true;
}

function updatePlayer(dt: number) {
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

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlayer() {
  const screenY = groundY - player.y;
  const w = PLAYER_W * player.squashX;
  const h = PLAYER_H * player.squashY;
  const cx = player.x;
  const cy = screenY - h / 2;

  // shadow
  ctx.save();
  ctx.globalAlpha = Math.max(0.12, 0.32 - player.y / 500);
  ctx.fillStyle = '#000000';
  const shadowScale = Math.max(0.35, 1 - player.y / MAX_JUMP_HEIGHT);
  ctx.beginPath();
  ctx.ellipse(cx, groundY, 22 * shadowScale, 7 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = PALETTE.player;
  ctx.strokeStyle = PALETTE.playerDark;
  ctx.lineWidth = 3;
  roundRect(-w / 2, -h / 2, w, h, 14);
  ctx.fill();
  ctx.stroke();

  const eyeOffsetX = player.facing * w * 0.16;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(eyeOffsetX - 2, -h * 0.08, 8, 0, Math.PI * 2);
  ctx.arc(eyeOffsetX + 14, -h * 0.08, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.playerEye;
  ctx.beginPath();
  ctx.arc(eyeOffsetX - 2 + player.facing * 2, -h * 0.08, 3.5, 0, Math.PI * 2);
  ctx.arc(eyeOffsetX + 14 + player.facing * 2, -h * 0.08, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ---------- Coins ----------

interface Coin {
  x: number;
  y: number; // height above ground
  bob: number;
  spin: number;
}

const COIN_COUNT = 3;
const COIN_RADIUS = 16;
const coins: Coin[] = [];

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
  return { x, y, bob: Math.random() * Math.PI * 2, spin: 0 };
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

function collectCoin(index: number, screenX: number, screenY: number) {
  coins.splice(index, 1);
  coins.push(spawnCoin());
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
  updateParticles(dt);
  updatePopups(dt);
  updateShake(dt);
  checkCoinCollisions();

  ctx.save();
  if (shakeTime > 0) {
    const sx = (Math.random() - 0.5) * shakeMag;
    const sy = (Math.random() - 0.5) * shakeMag;
    ctx.translate(sx, sy);
  }

  drawBackground();
  drawCoins();
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
requestAnimationFrame(frame);
