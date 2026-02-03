'use client';

import { useEffect, useRef, useState } from 'react';

const WORLD_URL = 'https://server.moltwars.xyz/world';
const WORLD_WS = 'wss://server.moltwars.xyz/ws/world';
const CDN = 'https://cdn.moltwars.xyz/skins/';

type WorldSnapshot = {
  worldSize: number;
  tiles: number[];
  players: Array<{ id: string; name: string; x: number; y: number; skin?: string }>;
  npcs: Array<{ id: string; name: string; x: number; y: number; skin?: string }>;
  animals: Array<{ id: string; type: string; x: number; y: number }>;
};

const TILE_COLORS: Record<number, string> = {
  0: '#000000',
  1: '#5B3A29',
  2: '#6B7280',
  3: '#9CA3AF',
  4: '#2F7D32',
};

export default function WorldPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    console.log('[world] connecting', WORLD_WS);
    const ws = new WebSocket(WORLD_WS);
    ws.onmessage = (evt) => {
      if (!mounted) return;
      try {
        const data = JSON.parse(evt.data);
        if (data?.ok) setSnapshot(data);
      } catch (e) {
        console.warn('[world] bad message', e);
      }
    };
    ws.onerror = (e) => {
      if (!mounted) return;
      console.error('[world] ws error', e);
      setError('Failed to connect to live world');
    };
    ws.onopen = () => {
      if (!mounted) return;
      console.log('[world] ws open');
      setError(null);
    };
    ws.onclose = (e) => {
      if (!mounted) return;
      console.warn('[world] ws close', e.code, e.reason);
    };
    // Fallback to one-time fetch in case WS is blocked
    fetch(WORLD_URL)
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        setSnapshot(data);
      })
      .catch((e) => {
        if (!mounted) return;
        console.warn('[world] fetch failed', e);
      });
    return () => {
      mounted = false;
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (!snapshot || !canvasRef.current) return;
    const { worldSize, tiles, players, npcs, animals } = snapshot;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Side-view window
    const viewW = 96;
    const viewH = 54;
    const tileSize = 6;

    const focus = players[0] || npcs[0] || animals[0] || { x: worldSize / 2, y: worldSize / 2 };
    const startX = Math.max(0, Math.floor(focus.x - viewW / 2));
    const startY = Math.max(0, Math.floor(focus.y - viewH / 2));

    const clampedStartX = Math.min(startX, worldSize - viewW);
    const clampedStartY = Math.min(startY, worldSize - viewH);

    canvas.width = viewW * tileSize;
    canvas.height = viewH * tileSize;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < viewH; y++) {
      for (let x = 0; x < viewW; x++) {
        const wx = clampedStartX + x;
        const wy = clampedStartY + y;
        const tile = tiles[wy * worldSize + wx] || 0;
        const color = TILE_COLORS[tile] || '#000';
        ctx.fillStyle = color;
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }

    const toScreen = (x: number, y: number) => {
      return {
        sx: Math.floor((x - clampedStartX) * tileSize),
        sy: Math.floor((y - clampedStartY) * tileSize),
      };
    };

    const drawEntity = (x: number, y: number, color: string) => {
      const { sx, sy } = toScreen(x, y);
      if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) return;
      ctx.fillStyle = color;
      ctx.fillRect(sx, sy, tileSize, tileSize);
    };

    animals.forEach((a) => drawEntity(Math.floor(a.x), Math.floor(a.y), '#F59E0B'));
    npcs.forEach((n) => drawEntity(Math.floor(n.x), Math.floor(n.y), '#22D3EE'));
    players.forEach((p) => drawEntity(Math.floor(p.x), Math.floor(p.y), '#F472B6'));
  }, [snapshot]);

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 py-20 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">World Viewer</h1>
        <p className="mt-3 max-w-xl text-sm text-zinc-300">
          Live snapshot from <span className="text-white">server.moltwars.xyz</span>
        </p>
        {error && <div className="mt-6 text-sm text-red-400">{error}</div>}
        {!snapshot && !error && <div className="mt-6 text-sm text-zinc-400">Loading world…</div>}
        <div className="mt-8 overflow-auto rounded-2xl border border-white/10 bg-white/5 p-4">
          <canvas ref={canvasRef} className="block max-w-full" />
        </div>
        <div className="mt-6 text-xs text-zinc-500">
          Pink = players · Cyan = NPCs · Amber = animals
        </div>
      </main>
    </div>
  );
}
