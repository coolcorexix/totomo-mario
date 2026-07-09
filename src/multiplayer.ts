import { createClient, type RealtimeChannel } from '@supabase/supabase-js';

const CHANNEL_NAME = 'totomo-mario-global';

const PLAYER_COLORS = [
  '#ff5a5f',
  '#38bdf8',
  '#4ade80',
  '#f472b6',
  '#fb923c',
  '#a78bfa',
  '#facc15',
];

export const localPlayerId =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `p-${Math.random().toString(36).slice(2)}`;

export const localPlayerColor =
  PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];

export interface RemotePlayerState {
  id: string;
  color: string;
  x: number;
  y: number;
  facing: number;
  squashX: number;
  squashY: number;
  score: number;
  targetX: number;
  targetY: number;
  lastSeen: number;
}

export interface CoinPayload {
  id: string;
  x: number;
  y: number;
}

type CoinEventHandler = (removedId: string, newCoin: CoinPayload, collectorId: string) => void;

const remotePlayers = new Map<string, RemotePlayerState>();
const coinEventHandlers: CoinEventHandler[] = [];

let channel: RealtimeChannel | null = null;
let ready = false;

export function getRemotePlayers(): RemotePlayerState[] {
  return Array.from(remotePlayers.values());
}

export function onlineCount(): number {
  return remotePlayers.size + 1;
}

export function onCoinEvent(handler: CoinEventHandler) {
  coinEventHandlers.push(handler);
}

function upsertRemote(payload: {
  id: string;
  color: string;
  x: number;
  y: number;
  facing: number;
  squashX: number;
  squashY: number;
  score: number;
}) {
  if (payload.id === localPlayerId) return;
  const existing = remotePlayers.get(payload.id);
  const now = performance.now();
  if (existing) {
    existing.targetX = payload.x;
    existing.targetY = payload.y;
    existing.facing = payload.facing;
    existing.squashX = payload.squashX;
    existing.squashY = payload.squashY;
    existing.score = payload.score;
    existing.color = payload.color;
    existing.lastSeen = now;
  } else {
    remotePlayers.set(payload.id, {
      id: payload.id,
      color: payload.color,
      x: payload.x,
      y: payload.y,
      targetX: payload.x,
      targetY: payload.y,
      facing: payload.facing,
      squashX: payload.squashX,
      squashY: payload.squashY,
      score: payload.score,
      lastSeen: now,
    });
  }
}

export function updateRemotePlayers(dt: number) {
  const now = performance.now();
  for (const [id, p] of remotePlayers) {
    const ease = Math.min(1, dt * 12);
    p.x += (p.targetX - p.x) * ease;
    p.y += (p.targetY - p.y) * ease;
    if (now - p.lastSeen > 8000) remotePlayers.delete(id);
  }
}

let lastSend = 0;
const SEND_INTERVAL = 1000 / 15;

export function sendPlayerState(state: {
  x: number;
  y: number;
  facing: number;
  squashX: number;
  squashY: number;
  score: number;
}) {
  if (!ready || !channel) return;
  const now = performance.now();
  if (now - lastSend < SEND_INTERVAL) return;
  lastSend = now;
  channel.send({
    type: 'broadcast',
    event: 'move',
    payload: { id: localPlayerId, color: localPlayerColor, ...state },
  });
}

export function broadcastCoinCollected(removedId: string, newCoin: CoinPayload) {
  if (!ready || !channel) return;
  channel.send({
    type: 'broadcast',
    event: 'coin',
    payload: { removedId, newCoin, collectorId: localPlayerId },
  });
}

export function initMultiplayer() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[multiplayer] missing Supabase env vars, running solo');
    return;
  }

  const supabase = createClient(url, key);
  channel = supabase.channel(CHANNEL_NAME, {
    config: {
      broadcast: { self: false },
      presence: { key: localPlayerId },
    },
  });

  channel
    .on('broadcast', { event: 'move' }, ({ payload }) => {
      upsertRemote(payload as Parameters<typeof upsertRemote>[0]);
    })
    .on('broadcast', { event: 'coin' }, ({ payload }) => {
      const { removedId, newCoin, collectorId } = payload as {
        removedId: string;
        newCoin: CoinPayload;
        collectorId: string;
      };
      for (const handler of coinEventHandlers) handler(removedId, newCoin, collectorId);
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      remotePlayers.delete(key);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        ready = true;
        await channel!.track({ id: localPlayerId, color: localPlayerColor });
      }
    });
}
