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
  chat?: Array<{ ts: number; message: string }>;
};

const SKY_TILE = 6;

const TILE_COLORS: Record<number, string> = {
  0: '#000000',
  1: '#5B3A29',
  2: '#6B7280',
  3: '#9CA3AF',
  4: '#2F7D32',
  5: '#4ADE80',
  6: '#7DD3FC',
};

export default function WorldPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const panCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ w: 1920, h: 1080 });
  const [showIntro, setShowIntro] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [chat, setChat] = useState<Array<{ ts: number; message: string }>>([]);
  const [follow, setFollow] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams(window.location.search);
    const followParam = params.get('follow');
    if (followParam) setFollow(followParam);
    console.log('[world] connecting', WORLD_WS);
    const ws = new WebSocket(WORLD_WS);
    ws.onmessage = (evt) => {
      if (!mounted) return;
      try {
        const data = JSON.parse(evt.data);
        if (data?.ok) {
          setSnapshot(data);
          if (Array.isArray(data.chat)) setChat(data.chat);
        }
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

  // viewport follows window size
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setViewport({ w, h });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowIntro(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const m = window.matchMedia('(pointer: coarse)');
    const check = () => setIsMobile(m.matches || window.innerWidth < 900);
    check();
    m.addEventListener('change', check);
    window.addEventListener('resize', check);
    return () => {
      m.removeEventListener('change', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  // pointer lock removed

  useEffect(() => {
    if (!snapshot || !canvasRef.current) return;
    const { worldSize, tiles, players, npcs, animals } = snapshot;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const baseTile = showIntro ? 6 : 14;
    const tileSize = baseTile * zoom;

    const viewW = Math.max(1, Math.min(worldSize, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(worldSize, Math.ceil(viewport.h / tileSize)));

    if (pan) {
      const clamped = {
        x: Math.max(0, Math.min(worldSize - viewW, pan.x)),
        y: Math.max(0, Math.min(worldSize - viewH, pan.y)),
      };
      if (clamped.x !== pan.x || clamped.y !== pan.y) {
        setPan(clamped);
        panCenterRef.current = clamped;
        return;
      }
    }

    // compute global surface (y=0 reference) as average first non-sky tile
    let sum = 0;
    let count = 0;
    for (let x = 0; x < worldSize; x++) {
      for (let y = 0; y < worldSize; y++) {
        const t = tiles[y * worldSize + x];
        if (t !== SKY_TILE) {
          sum += y;
          count += 1;
          break;
        }
      }
    }
    const surfaceY = count ? Math.floor(sum / count) : Math.floor(worldSize / 2);

    const focus =
      (follow && players.find((p) => p.name.toLowerCase() === follow.toLowerCase())) ||
      players[0] ||
      npcs[0] ||
      animals[0] ||
      { x: worldSize / 2, y: surfaceY };

    if (!pan) {
      const initial = { x: Math.floor(focus.x - viewW / 2), y: Math.floor(surfaceY - viewH / 2) };
      setPan(initial);
      panCenterRef.current = initial;
      return;
    }

    // soft follow: gently pull pan toward target
    if (follow && focus) {
      const targetX = Math.floor(focus.x - viewW / 2);
      const targetY = Math.floor(focus.y - viewH / 2);
      const next = {
        x: Math.floor(pan.x + (targetX - pan.x) * 0.05),
        y: Math.floor(pan.y + (targetY - pan.y) * 0.05),
      };
      setPan(next);
      panCenterRef.current = next;
    }

    let startX = Math.max(0, Math.min(worldSize - viewW, pan.x));
    let startY = Math.max(0, Math.min(worldSize - viewH, pan.y));

    canvas.width = viewport.w;
    canvas.height = viewport.h;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < viewH; y++) {
      const wy = startY + y;
      for (let x = 0; x < viewW; x++) {
        const wx = startX + x;
        const tile = tiles[wy * worldSize + wx] || 0;
        const color = TILE_COLORS[tile] || '#000';
        ctx.fillStyle = color;
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }

    const toScreen = (x: number, y: number) => {
      return {
        sx: Math.floor((x - startX) * tileSize),
        sy: Math.floor((y - startY) * tileSize),
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
  }, [snapshot, pan, zoom, viewport]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((z) => Math.min(6, Math.max(0.1, +(z + delta).toFixed(2))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (showIntro) return;
    setIsDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan?.x || 0, panY: pan?.y || 0 };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (showIntro || !dragRef.current) return;
    const baseTile = showIntro ? 6 : 14;
    const tileSize = baseTile * zoom;
    const dx = (e.clientX - dragRef.current.x) / tileSize;
    const dy = (e.clientY - dragRef.current.y) / tileSize;
    setPan({ x: Math.floor(dragRef.current.panX - dx), y: Math.floor(dragRef.current.panY - dy) });
  };

  const stopDrag = () => {
    setIsDragging(false);
    dragRef.current = null;
    if (pan) panCenterRef.current = pan;
  };

  // no pointer lock

  return (
    <div className="min-h-screen bg-black">
      {error && <div className="p-4 text-sm text-red-400">{error}</div>}
      {!snapshot && !error && <div className="p-4 text-sm text-zinc-400">Loading…</div>}
      <div className="h-screen w-screen overflow-hidden bg-black flex items-center justify-center relative">
        <div
          ref={containerRef}
          className="bg-black w-full h-full"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
        >
          <canvas ref={canvasRef} className="block w-full h-full" />
        </div>

        {!showIntro && !isMobile && (
          <div className="absolute left-4 top-4 w-[220px] space-y-1 rounded-xl border border-white/10 bg-black/60 p-3 text-xs text-white">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Active Players</div>
            <div className="max-h-56 space-y-1 overflow-auto">
              {(snapshot?.players || []).map((p) => (
                <button
                  key={p.id}
                  className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-white/10 ${follow === p.name ? 'bg-white/10' : ''}`}
                  onClick={() => {
                    setFollow(p.name);
                    if (pan && snapshot) {
                      const viewW = Math.max(1, Math.min(snapshot.worldSize, Math.floor(snapshot.worldSize / 2)));
                      const viewH = Math.max(1, Math.min(snapshot.worldSize, Math.floor(snapshot.worldSize / 2)));
                      const next = { x: Math.floor(p.x - viewW / 2), y: Math.floor(p.y - viewH / 2) };
                      setPan(next);
                      panCenterRef.current = next;
                    }
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!showIntro && !isMobile && (
          <div className="absolute left-4 bottom-4 w-[320px] space-y-1 rounded-xl border border-white/10 bg-black/60 p-3 text-xs text-white">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">World Chat</div>
            <div className="max-h-40 space-y-1 overflow-hidden">
              {chat.slice(-8).map((c) => (
                <div key={c.ts} className="truncate">{c.message}</div>
              ))}
            </div>
          </div>
        )}

        {(showIntro || isMobile) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="max-w-md rounded-2xl border border-white/10 bg-black/80 p-6 text-sm text-zinc-200 shadow-xl">
              <div className="text-lg font-semibold text-white">Welcome to Moltwars</div>
              <div className="mt-2 text-zinc-300">
                {isMobile
                  ? 'World viewer is PC-only.'
                  : 'Drag to pan. Scroll to zoom.'}
              </div>
              {!isMobile && (
                <button
                  className="mt-4 rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-wide text-white hover:border-white/50"
                  onClick={() => {
                    setShowIntro(false);
                    if (pan) panCenterRef.current = pan;
                  }}
                >
                  Enter world
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
