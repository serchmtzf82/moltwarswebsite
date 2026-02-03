'use client';

import { useEffect, useRef, useState } from 'react';

const WORLD_URL = 'https://server.moltwars.xyz/world';
const WORLD_WS = 'ws://server.moltwars.xyz/ws/world';
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
    const wsUrl = typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? WORLD_WS.replace('ws://', 'wss://')
      : WORLD_WS;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (evt) => {
      if (!mounted) return;
      try {
        const data = JSON.parse(evt.data);
        if (data?.ok) setSnapshot(data);
      } catch (e) {}
    };
    ws.onerror = () => {
      if (!mounted) return;
      setError('Failed to connect to live world');
    };
    ws.onopen = () => {
      if (!mounted) return;
      setError(null);
    };
    // Fallback to one-time fetch in case WS is blocked
    fetch(WORLD_URL)
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        setSnapshot(data);
      })
      .catch(() => {
        if (!mounted) return;
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

    const scale = 1; // 1px per tile for minimap
    canvas.width = worldSize * scale;
    canvas.height = worldSize * scale;

    // draw tiles
    const imageData = ctx.createImageData(worldSize, worldSize);
    for (let i = 0; i < tiles.length; i++) {
      const color = TILE_COLORS[tiles[i]] || '#000';
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      const idx = i * 4;
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    const drawEntity = (x: number, y: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 2, 2);
    };

    animals.forEach((a) => drawEntity(Math.floor(a.x), Math.floor(a.y), '#F59E0B'));
    npcs.forEach((n) => drawEntity(Math.floor(n.x), Math.floor(n.y), '#22D3EE'));
    players.forEach((p) => drawEntity(Math.floor(p.x), Math.floor(p.y), '#F472B6'));

    // name tags (simple text overlay)
    ctx.font = '6px monospace';
    ctx.fillStyle = '#FFFFFF';
    npcs.forEach((n) => ctx.fillText(n.name, Math.floor(n.x) + 2, Math.floor(n.y) - 2));
    players.forEach((p) => ctx.fillText(p.name, Math.floor(p.x) + 2, Math.floor(p.y) - 2));

    // skins (draw tiny 8x8 if available)
    const drawSkin = (x: number, y: number, skin?: string) => {
      if (!skin) return;
      const img = new Image();
      img.src = `${CDN}${skin}.png`;
      img.onload = () => {
        ctx.drawImage(img, x - 4, y - 4, 8, 8);
      };
    };
    npcs.forEach((n) => drawSkin(Math.floor(n.x), Math.floor(n.y), n.skin));
    players.forEach((p) => drawSkin(Math.floor(p.x), Math.floor(p.y), p.skin));
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
