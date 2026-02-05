'use client';

import { useEffect, useRef, useState } from 'react';

const WORLD_URL = 'https://server.moltwars.xyz/world';
const WORLD_WS = 'wss://server.moltwars.xyz/ws/world';
// Note: server.moltwars.xyz is now fronted by Cloudflare Worker/DO
const CDN = 'https://cdn.moltwars.xyz/skins/';

type WorldSnapshot = {
  worldWidth: number;
  worldHeight: number;
  worldSize?: number;
  tiles: number[] | number[][];
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  players: Array<{ id: string; name: string; x: number; y: number; skin?: string; look?: number }>;
  npcs: Array<{ id: string; name: string; x: number; y: number; skin?: string; stats?: { blocksMined?: number; itemsCrafted?: number; playtimeMs?: number } }>;
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
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const samePan = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) =>
    !!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

  const clampPan = (p: { x: number; y: number }, tileSize: number) => {
    const wsW = snapshot?.worldWidth || snapshot?.worldSize || 256;
    const wsH = snapshot?.worldHeight || snapshot?.worldSize || 256;
    const viewW = Math.max(1, Math.min(wsW, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(wsH, Math.ceil(viewport.h / tileSize)));
    return {
      x: Math.max(0, Math.min(wsW - viewW, p.x)),
      y: Math.max(0, Math.min(wsH - viewH, p.y)),
    };
  };

  const [zoom, setZoom] = useState(1);
  const [zoomTarget, setZoomTarget] = useState(1);
  const [viewport, setViewport] = useState({ w: 1920, h: 1080 });
  const [showIntro, setShowIntro] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [chat, setChat] = useState<Array<{ ts: number; message: string }>>([]);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hovered, setHovered] = useState<any | null>(null);
  const playerImgRef = useRef<HTMLImageElement | null>(null);
  const npcImgRef = useRef<HTMLImageElement | null>(null);
  const stoneImgRef = useRef<HTMLImageElement | null>(null);
  const formatUtc = () => new Date().toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true });
  const [timeUtc, setTimeUtc] = useState<string>("--:--");
  const [bubbles, setBubbles] = useState<Record<string, { message: string; expiresAt: number }>>({});
  const surfaceRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams(window.location.search);
    const followParam = params.get('follow');
    if (followParam) setFollow(followParam);
    console.log('[world] connecting', WORLD_WS);
    const ws = new WebSocket(WORLD_WS);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      if (!mounted) return;
      try {
        const data = JSON.parse(evt.data);
        if (data?.ok) {
          setSnapshot(data);
          if (Array.isArray(data.chat)) setChat(data.chat);
        }
        if (data?.type === 'npcChat' && data.npcId) {
          const ttl = data.ttlMs || 6000;
          setBubbles((b) => ({
            ...b,
            [data.npcId]: { message: data.message, expiresAt: Date.now() + ttl },
          }));
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
    // no REST fallback in push-only mode
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

  // smooth zoom only (pan is direct)
  useEffect(() => {
    let raf: number;
    const tick = () => {
      setZoom((z) => {
        if (zoomTarget === null) return z;
        const nz = z + (zoomTarget - z) * 0.35;
        if (Math.abs(nz - zoomTarget) < 0.002) return zoomTarget;
        return nz;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [zoomTarget]);

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
    const p = new Image();
    p.src = "https://cdn.moltwars.xyz/sprites/player.png";
    playerImgRef.current = p;
    const n = new Image();
    n.src = "https://cdn.moltwars.xyz/sprites/player.png";
    npcImgRef.current = n;
    const s = new Image();
    s.src = "https://cdn.moltwars.xyz/sprites/stone.png";
    stoneImgRef.current = s;
  }, []);

  useEffect(() => {
    setTimeUtc(formatUtc());
    const t = setInterval(() => setTimeUtc(formatUtc()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!chatRef.current) return;
    chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat]);

  // init pan once snapshot is ready
  useEffect(() => {
    if (!snapshot || pan) return;
    const baseTile = showIntro ? 16 : 36;
    const worldSize = snapshot.worldWidth || snapshot.worldSize || 256;
    const worldHeight = snapshot.worldHeight || snapshot.worldSize || 256;
    const tileSize = Math.max(1, Math.round(baseTile * zoom));
    const viewW = Math.max(1, Math.min(worldSize, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(worldHeight, Math.ceil(viewport.h / tileSize)));
    const initial = { x: Math.floor(worldSize / 2 - viewW / 2), y: Math.floor(worldHeight * 0.22 - viewH / 2) };
    setPan(clampPan(initial, tileSize));
  }, [snapshot, pan, zoom, viewport, showIntro]);

  // follow target
  useEffect(() => {
    if (!follow || !snapshot) return;
    const baseTile = showIntro ? 16 : 36;
    const tileSize = Math.max(1, Math.round(baseTile * zoom));
    const worldSize = snapshot.worldWidth || snapshot.worldSize || 256;
    const worldHeight = snapshot.worldHeight || snapshot.worldSize || 256;
    const viewW = Math.max(1, Math.min(worldSize, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(worldHeight, Math.ceil(viewport.h / tileSize)));
    const focus =
      snapshot.players?.find((p: any) => p.name.toLowerCase() === follow.toLowerCase()) ||
      snapshot.npcs?.find((p: any) => p.name.toLowerCase() === follow.toLowerCase()) ||
      snapshot.animals?.find((p: any) => p.name?.toLowerCase?.() === follow.toLowerCase());
    if (!focus) return;
    const target = { x: Math.floor(focus.x - viewW / 2), y: Math.floor(focus.y - viewH / 2) };
    const clamped = clampPan(target, tileSize);
    if (!samePan(pan, clamped)) setPan(clamped);
  }, [follow, snapshot, viewport, zoom, showIntro, pan]);

  useEffect(() => {
    if (!follow || !snapshot) return;
    const p = snapshot.players?.find((pl: any) => pl.name.toLowerCase() === follow.toLowerCase());
    const n = snapshot.npcs?.find((pl: any) => pl.name.toLowerCase() === follow.toLowerCase());
    const a = snapshot.animals?.find((pl: any) => pl.name?.toLowerCase?.() === follow.toLowerCase());
    if (p) setHovered({ ...p });
    else if (n) setHovered({ ...n });
    else if (a) setHovered({ ...a });
  }, [follow, snapshot]);

  useEffect(() => {
    if (!snapshot || !canvasRef.current) return;
    const { worldWidth, worldHeight, tiles, players, npcs, animals } = snapshot;
    const worldSize = worldWidth || snapshot.worldSize || 256;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const baseTile = showIntro ? 16 : 36;
    const tileSize = Math.max(1, Math.round(baseTile * zoom));

    const viewW = Math.max(1, Math.min(worldSize, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(worldHeight || worldSize, Math.ceil(viewport.h / tileSize)));
    const viewWActual = snapshot.w || viewW;
    const viewHActual = snapshot.h || viewH;
    const is2d = Array.isArray(tiles) && Array.isArray(tiles[0]);

    // clamp handled at render time

    // compute global surface (y=0 reference) as average first non-sky tile
    let sum = 0;
    let count = 0;
    for (let x = 0; x < worldSize; x++) {
      for (let y = 0; y < (worldHeight || worldSize); y++) {
        const t = tiles[y * worldSize + x];
        if (t !== SKY_TILE) {
          sum += y;
          count += 1;
          break;
        }
      }
    }
    const surfaceY = count ? Math.floor(sum / count) : Math.floor((worldHeight || worldSize) / 2);
    surfaceRef.current = surfaceY;

    const focus =
      (follow && players.find((p) => p.name.toLowerCase() === follow.toLowerCase())) ||
      players[0] ||
      npcs[0] ||
      animals[0] ||
      { x: worldSize / 2, y: surfaceY };

    let panBase = pan || { x: 0, y: 0 };

    const startX = Math.floor(Math.max(0, Math.min(worldSize - viewWActual, snapshot.x ?? panBase?.x ?? 0)));
    const startY = Math.floor(Math.max(0, Math.min((worldHeight || worldSize) - viewHActual, snapshot.y ?? panBase?.y ?? 0)));

    canvas.width = viewWActual * tileSize;
    canvas.height = viewHActual * tileSize;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < viewHActual; y++) {
      for (let x = 0; x < viewWActual; x++) {
        const tile = is2d
          ? (tiles as number[][])?.[y]?.[x]
          : (tiles as number[])[(startY + y) * worldSize + (startX + x)];
        let color = TILE_COLORS[tile ?? 0] || '#000';
        const worldY = startY + y;
        if ((tile ?? 0) === 0 && worldY > surfaceY) {
          color = '#0b0f14'; // deep stone shadow
        }
        if ((tile ?? 0) === 2 && stoneImgRef.current?.complete) {
          ctx.drawImage(stoneImgRef.current, x * tileSize, y * tileSize, tileSize, tileSize);
        } else {
          ctx.fillStyle = color;
          ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
      }
    }

    const toScreen = (x: number, y: number) => {
      return {
        sx: Math.floor((x - startX) * tileSize),
        sy: Math.floor((y - startY) * tileSize),
      };
    };

    const drawEntity = (x: number, y: number, color: string, look: number = 1) => {
      const { sx, sy } = toScreen(x, y);
      if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) return;
      ctx.fillStyle = color;
      ctx.fillRect(sx, sy, tileSize, tileSize);
      ctx.strokeStyle = '#ffffff66';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, tileSize - 1, tileSize - 1);
    };

    animals.forEach((a) => drawEntity(Math.floor(a.x), Math.floor(a.y), '#F59E0B'));
    npcs.forEach((n) => {
      if (npcImgRef.current?.complete) {
        const { sx, sy } = toScreen(Math.floor(n.x), Math.floor(n.y));
        ctx.drawImage(npcImgRef.current, sx, sy, tileSize, tileSize);
      } else {
        drawEntity(Math.floor(n.x), Math.floor(n.y), '#22D3EE');
      }
    });
    players.forEach((p) => {
      if (playerImgRef.current?.complete) {
        const { sx, sy } = toScreen(Math.floor(p.x), Math.floor(p.y));
        const dir = (p.look ?? 1) === 0 ? -1 : 1;
        ctx.save();
        ctx.translate(sx + (dir === -1 ? tileSize : 0), sy);
        ctx.scale(dir, 1);
        ctx.drawImage(playerImgRef.current, 0, 0, tileSize, tileSize);
        ctx.restore();
      } else {
        drawEntity(Math.floor(p.x), Math.floor(p.y), '#F472B6', p.look ?? 1);
      }
    });

    // bubble cleanup
    const now = Date.now();
    const cleaned: Record<string, { message: string; expiresAt: number }> = {};
    for (const [id, b] of Object.entries(bubbles)) {
      if (b.expiresAt > now) cleaned[id] = b;
    }
    if (Object.keys(cleaned).length !== Object.keys(bubbles).length) setBubbles(cleaned);

    // npc speech bubbles
    for (const n of npcs) {
      const b = bubbles[n.id];
      if (!b) continue;
      const { sx, sy } = toScreen(Math.floor(n.x), Math.floor(n.y));
      if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height) continue;
      ctx.font = '12px sans-serif';
      const text = b.message;
      const padding = 4;
      const w = Math.min(220, ctx.measureText(text).width + padding * 2);
      const h = 18;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sx - w / 2, sy - h - 6, w, h);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, sx - w / 2 + padding, sy - 8);
    }

    // hover detection (players only)
    if (mouseRef.current) {
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const wx = startX + Math.floor(mx / tileSize);
      const wy = startY + Math.floor(my / tileSize);
      const foundPlayer = players.find((p) => Math.floor(p.x) === wx && Math.floor(p.y) === wy);
      const foundNpc = npcs.find((n) => Math.floor(n.x) === wx && Math.floor(n.y) === wy);
      setHovered(foundPlayer ? { ...foundPlayer } : foundNpc ? { ...foundNpc } : null);
    }
  }, [snapshot, pan, zoom, viewport, bubbles]);

  useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;
    if (!pan || !snapshot) return;
    const baseTile = showIntro ? 16 : 36;
    const tileSize = Math.max(1, Math.round(baseTile * zoomTarget));
    const wsW = snapshot.worldWidth || snapshot.worldSize || 256;
    const wsH = snapshot.worldHeight || snapshot.worldSize || 256;
    const viewW = Math.max(1, Math.min(wsW, Math.ceil(viewport.w / tileSize)));
    const viewH = Math.max(1, Math.min(wsH, Math.ceil(viewport.h / tileSize)));
    const x = Math.max(0, Math.min(wsW - viewW, Math.floor(pan.x)));
    const y = Math.max(0, Math.min(wsH - viewH, Math.floor(pan.y)));
    wsRef.current.send(JSON.stringify({ type: 'view', x, y, w: viewW, h: viewH }));
  }, [pan, zoomTarget, viewport, snapshot, showIntro]);

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? -0.03 : 0.03;
    const baseTile = showIntro ? 16 : 36;
    const wsW = snapshot?.worldWidth || snapshot?.worldSize || 256;
    const wsH = snapshot?.worldHeight || snapshot?.worldSize || 256;
    const minZoomW = viewport.w / (wsW * baseTile);
    const minZoomH = viewport.h / (wsH * baseTile);
    const minZoom = Math.max(0.1, minZoomW, minZoomH);
    const minTiles = follow ? 40 : 100;
    const maxZoom = viewport.w / (minTiles * baseTile); // keep at least minTiles visible
    const next = Math.min(maxZoom, Math.max(minZoom, +(zoomTarget + delta).toFixed(2)));
    // zoom towards cursor
    const mouse = mouseRef.current;
    if (mouse && pan) {
      const tileSize = baseTile * zoom;
      const worldX = pan.x + mouse.x / tileSize;
      const worldY = pan.y + mouse.y / tileSize;
      const newTileSize = baseTile * next;
      setPan(clampPan({ x: worldX - mouse.x / newTileSize, y: worldY - mouse.y / newTileSize }, newTileSize));
    }
    setZoomTarget(next);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (showIntro) return;
    setIsDragging(true);
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan?.x || 0, panY: pan?.y || 0 };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (showIntro || !dragRef.current) return;
    const baseTile = showIntro ? 16 : 36;
    const tileSize = baseTile * zoom;
    const dx = (e.clientX - dragRef.current.x) / tileSize;
    const dy = (e.clientY - dragRef.current.y) / tileSize;
    const next = { x: dragRef.current.panX - dx, y: dragRef.current.panY - dy };
    setPan(clampPan(next, tileSize));
  };

  const stopDrag = () => {
    setIsDragging(false);
    dragRef.current = null;
  };

  // no pointer lock

  return (
    <div className="min-h-screen bg-black">
      {error && <div className="p-4 text-sm text-red-400">{error}</div>}
      {!snapshot && !error && <div className="p-4 text-sm text-zinc-400">Loading…</div>}
      <div className="h-screen w-screen overflow-hidden bg-black flex items-center justify-center relative">
        <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs text-zinc-200">{timeUtc}</div>
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
              {[...(snapshot?.players || []).map(p => ({...p, kind:'player'})), ...(snapshot?.npcs || []).map(n => ({...n, kind:'npc'}))].map((p) => (
                <button
                  key={`${p.kind}-${p.id}`}
                  className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-white/10 ${follow === p.name ? 'bg-white/10' : ''}`}
                  onClick={() => {
                    setFollow(p.name);
                    if (snapshot) {
                      const base = 36;
                      const wsW = snapshot.worldWidth || snapshot.worldSize || 256;
                      const wsH = snapshot.worldHeight || snapshot.worldSize || 256;
                      const maxZoom = viewport.w / (40 * base); // at least 40 tiles visible
                      const minZoomW = viewport.w / (wsW * base);
                      const minZoomH = viewport.h / (wsH * base);
                      const minZoom = Math.max(0.1, minZoomW, minZoomH);
                      const targetZoom = Math.min(maxZoom, Math.max(minZoom, maxZoom));
                      setZoomTarget(targetZoom);

                      const viewW = Math.max(1, Math.min(wsW, Math.ceil(viewport.w / (base * targetZoom))));
                      const viewH = Math.max(1, Math.min(wsH, Math.ceil(viewport.h / (base * targetZoom))));
                      const next = { x: Math.floor(p.x - viewW / 2), y: Math.floor(p.y - viewH / 2) };
                      setPan(next);
                    }
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
            {follow && (
              <button
                className="mt-2 w-full rounded border border-white/20 px-2 py-1 text-xs uppercase tracking-wide text-white hover:border-white/50"
                onClick={() => setFollow(null)}
              >
                Stop follow
              </button>
            )}
          </div>
        )}

        {!showIntro && !isMobile && hovered && (
          <div className="absolute right-4 bottom-4 w-[240px] space-y-1 rounded-xl border border-white/10 bg-black/70 p-3 text-xs text-white">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">Player</div>
            <div className="text-sm font-semibold">{hovered.name}</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-300">
              <div>Kills: {hovered.stats?.kills ?? 0}</div>
              <div>Deaths: {hovered.stats?.deaths ?? 0}</div>
              <div>K/D: {((hovered.stats?.kills ?? 0) / Math.max(1, hovered.stats?.deaths ?? 0)).toFixed(2)}</div>
              <div>Mined: {hovered.stats?.blocksMined ?? 0}</div>
              <div>Crafted: {hovered.stats?.itemsCrafted ?? 0}</div>
              <div>Playtime: {Math.floor((hovered.stats?.playtimeMs ?? 0) / 60000)}m</div>
            </div>
          </div>
        )}

        {!showIntro && !isMobile && (
          <div className="absolute left-4 bottom-4 w-[420px] space-y-2 rounded-xl border border-white/10 bg-black/60 p-4 text-sm text-white">
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-400">World Chat</div>
            <div ref={chatRef} className="max-h-56 space-y-1 overflow-y-auto pr-1">
              {chat.slice(-12).map((c) => {
                const isSystem = c.message.startsWith('🟡 ');
                const msg = isSystem ? c.message.replace(/^🟡\s*/, '') : c.message;
                return (
                  <div key={c.ts} className={isSystem ? 'truncate text-yellow-400' : 'truncate'}>{msg}</div>
                );
              })}
            </div>
          </div>
        )}

        {(showIntro || isMobile) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70">
            <div className="max-w-md rounded-2xl border border-white/10 bg-black/80 p-6 text-sm text-zinc-200 shadow-xl">
              <div className="text-lg font-semibold text-white">Welcome to the Moltwars Worldviewer</div>
              <div className="mt-2 text-zinc-300">
                {isMobile
                  ? 'World viewer is PC-only.'
                  : 'Drag to pan. Scroll to zoom. '}
              </div>
                            <div className="mt-2 text-zinc-300">
                {isMobile
                  ? 'World viewer is PC-only.'
                  : 'Click on players in the player list to follow them. '}
              </div>
              {!isMobile && (
                <button
                  className="mt-4 rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-wide text-white hover:border-white/50"
                  onClick={() => {
                    setShowIntro(false);
                    if (snapshot) {
                      const baseTile = 36;
                      const wsW = snapshot.worldWidth || snapshot.worldSize || 256;
                      const wsH = snapshot.worldHeight || snapshot.worldSize || 256;
                      const minZoomW = viewport.w / (wsW * baseTile);
                      const minZoomH = viewport.h / (wsH * baseTile);
                      const minZoom = Math.max(0.1, minZoomW, minZoomH);
                      const maxZoom = viewport.w / (200 * baseTile);
                      const targetZoom = Math.min(maxZoom, Math.max(minZoom, zoomTarget));
                      setZoomTarget(targetZoom);

                      const tileSize = baseTile * targetZoom;
                      const viewW = Math.max(1, Math.min(wsW, Math.ceil(viewport.w / tileSize)));
                      const viewH = Math.max(1, Math.min(wsH, Math.ceil(viewport.h / tileSize)));
                      const surfaceY = surfaceRef.current ?? Math.floor(wsH / 2);
                      const focusX = (snapshot.players?.[0]?.x ?? wsW / 2);
                      const next = { x: Math.floor(focusX - viewW / 2), y: Math.floor(surfaceY - viewH / 2) };
                      setPan(next);
                    } else if (pan) {
                                          }
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
