<script lang="ts">
  import { designer as d } from "../lib/designer.svelte";
  import { edgeTargets, right, snapAxis, setRect, solve, top, uiSize, type Rect } from "../lib/layout";
  import { isContainer, LAYERS, STRATA, type SceneNode } from "../lib/scene";
  import { expandEntries, resolve, visibleChain, type Entry } from "../lib/sim/bind";
  import { assets } from "../lib/assets.svelte";

  let viewport: HTMLDivElement;
  const ui = $derived(uiSize(d.scene));

  // Fit-to-window zoom
  function refit() {
    if (!viewport || !d.fit) return;
    const pad = 48;
    d.zoom = Math.max(0.1, Math.min((viewport.clientWidth - pad) / ui.w, (viewport.clientHeight - pad) / ui.h, 4));
  }
  $effect(() => { void ui.w; void ui.h; refit(); });
  $effect(() => { if (!viewport) return; const ro = new ResizeObserver(refit); ro.observe(viewport); return () => ro.disconnect(); });

  // ---- z-order: strata, frame level, then region layer, then creation order ----
  interface Item { entry: Entry; z: number }
  const entries = $derived(expandEntries(d.scene, d.solved.rects, d.preview, d.scenario));
  const items = $derived.by(() => {
    const eff = new Map<string, { strata: number; level: number }>();
    const calc = (n: SceneNode): { strata: number; level: number } => {
      const hit = eff.get(n.id); if (hit) return hit;
      const p = n.parent ? d.scene.nodes[n.parent] : null;
      const pe = p ? calc(p) : { strata: 0, level: 0 };
      const isRegion = n.kind === "texture" || n.kind === "fontstring";
      const own = STRATA.indexOf(n.strata);
      const v = isRegion ? pe : { strata: own !== 2 ? own : pe.strata, level: (p ? pe.level + 1 : 0) + n.level };
      eff.set(n.id, v); return v;
    };
    const keyed = entries.map((entry, idx) => {
      const n = d.scene.nodes[entry.id]!; const e = calc(n);
      const region = n.kind === "texture" || n.kind === "fontstring";
      return { entry, key: [e.strata, e.level, region ? 1 : 0, region ? LAYERS.indexOf(n.layer) : 0, idx] };
    });
    keyed.sort((a, b) => { for (let i = 0; i < 5; i++) { const x = a.key[i]! - b.key[i]!; if (x) return x; } return 0; });
    return keyed.map((k, i): Item => ({ entry: k.entry, z: i + 1 }));
  });

  const css = (c: number[]) => `rgba(${Math.round(c[0]! * 255)},${Math.round(c[1]! * 255)},${Math.round(c[2]! * 255)},${c[3]})`;
  const px = (v: number) => `${v * d.zoom}px`;

  // ---- interaction ----
  type Mode = null | { kind: "move" | "resize"; handle: string; sx: number; sy: number; start: Rect; id: string; solved: ReturnType<typeof solve> };
  let mode: Mode = null;

  function siblingsRects(id: string): Rect[] {
    const n = d.scene.nodes[id]!;
    const out: Rect[] = [{ l: 0, b: 0, w: ui.w, h: ui.h }];
    const parent = n.parent ? d.solved.rects.get(n.parent) : null;
    if (parent) out.push(parent);
    for (const o of d.scene.order) { if (o === id) continue; const on = d.scene.nodes[o]!; if (on.parent === n.parent && d.solved.rects.has(o)) out.push(d.solved.rects.get(o)!); }
    return out;
  }

  function down(e: PointerEvent, id: string) {
    e.stopPropagation();
    d.selection = id;
    const r = d.solved.rects.get(id); if (!r) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    d.begin();
    mode = { kind: "move", handle: "", sx: e.clientX, sy: e.clientY, start: { ...r }, id, solved: d.solved };
  }
  function downHandle(e: PointerEvent, handle: string) {
    e.stopPropagation();
    const id = d.selection; if (!id) return; const r = d.solved.rects.get(id); if (!r) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    d.begin();
    mode = { kind: "resize", handle, sx: e.clientX, sy: e.clientY, start: { ...r }, id, solved: d.solved };
  }
  function move(e: PointerEvent) {
    if (!mode) return;
    const dx = (e.clientX - mode.sx) / d.zoom, dy = -(e.clientY - mode.sy) / d.zoom;
    const useSnap = d.snap && !e.altKey;
    const others = siblingsRects(mode.id);
    const tx = edgeTargets(others, "x"), ty = edgeTargets(others, "y");
    const g = Math.max(1, d.grid), thr = 5 / d.zoom;
    const s = mode.start;
    let rect: Rect = { ...s };
    const guides: typeof d.guides = [];
    if (mode.kind === "move") {
      let l = s.l + dx, b = s.b + dy;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) b = s.b; else l = s.l; }
      if (useSnap) {
        const sx = snapAxis([l, l + s.w / 2, l + s.w], tx, g, thr, d.showGrid || d.grid > 0);
        const sy = snapAxis([b, b + s.h / 2, b + s.h], ty, g, thr, d.showGrid || d.grid > 0);
        l += sx.delta; b += sy.delta;
        if (sx.guide !== null) guides.push({ axis: "x", pos: sx.guide });
        if (sy.guide !== null) guides.push({ axis: "y", pos: sy.guide });
      }
      rect = { l: Math.round(l), b: Math.round(b), w: s.w, h: s.h };
    } else {
      let l = s.l, r = right(s), b = s.b, t = top(s);
      const h = mode.handle;
      if (h.includes("w")) l = s.l + dx;
      if (h.includes("e")) r = right(s) + dx;
      if (h.includes("s")) b = s.b + dy;
      if (h.includes("n")) t = top(s) + dy;
      if (useSnap) {
        if (h.includes("w")) { const q = snapAxis([l], tx, g, thr, true); l += q.delta; if (q.guide !== null) guides.push({ axis: "x", pos: q.guide }); }
        if (h.includes("e")) { const q = snapAxis([r], tx, g, thr, true); r += q.delta; if (q.guide !== null) guides.push({ axis: "x", pos: q.guide }); }
        if (h.includes("s")) { const q = snapAxis([b], ty, g, thr, true); b += q.delta; if (q.guide !== null) guides.push({ axis: "y", pos: q.guide }); }
        if (h.includes("n")) { const q = snapAxis([t], ty, g, thr, true); t += q.delta; if (q.guide !== null) guides.push({ axis: "y", pos: q.guide }); }
      }
      l = Math.round(l); r = Math.round(r); b = Math.round(b); t = Math.round(t);
      if (r - l < 1) { if (h.includes("w")) l = r - 1; else r = l + 1; }
      if (t - b < 1) { if (h.includes("s")) b = t - 1; else t = b + 1; }
      rect = { l, b, w: r - l, h: t - b };
    }
    setRect(d.scene, mode.id, rect, mode.solved);
    d.guides = guides; d.touch();
  }
  function up() { if (mode) { mode = null; d.commit(); } }

  function key(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (mod && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? d.redo() : d.undo(); }
    else if (mod && k.toLowerCase() === "y") { e.preventDefault(); d.redo(); }
    else if (mod && k.toLowerCase() === "d") { e.preventDefault(); d.dup(); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); d.remove(); }
    else if (k === "Escape") d.selection = null;
    else if (k.startsWith("Arrow") && d.selection) {
      e.preventDefault(); const st = e.shiftKey ? 10 : 1;
      d.nudge(k === "ArrowLeft" ? -st : k === "ArrowRight" ? st : 0, k === "ArrowUp" ? st : k === "ArrowDown" ? -st : 0);
    } else if (k === "]") d.z(1); else if (k === "[") d.z(-1);
  }
  function wheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault(); d.fit = false;
    d.zoom = Math.max(0.1, Math.min(6, d.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  }
  const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const hpos = (h: string, r: Rect) => {
    const x = h.includes("w") ? 0 : h.includes("e") ? 100 : 50, y = h.includes("n") ? 0 : h.includes("s") ? 100 : 50;
    return `left:${x}%;top:${y}%`;
  };
  const cursors: Record<string, string> = { nw: "nwse", se: "nwse", ne: "nesw", sw: "nesw", n: "ns", s: "ns", e: "ew", w: "ew" };
</script>

<svelte:window onpointermove={move} onpointerup={up} onkeydown={key} />

<div class="vp" bind:this={viewport} onwheel={wheel} onpointerdown={() => (d.selection = null)} role="presentation">
  <div class="screen" style="width:{px(ui.w)};height:{px(ui.h)};{d.showGrid && d.grid > 0 && d.zoom * d.grid >= 4 ? `background-image:linear-gradient(#ffffff0d 1px,transparent 1px),linear-gradient(90deg,#ffffff0d 1px,transparent 1px);background-size:${d.grid * d.zoom}px ${d.grid * d.zoom}px;` : ''}">
    <div class="uip">UIParent {Math.round(ui.w)}×{Math.round(ui.h)}</div>
    {#if d.preview}<div class="live" class:on={d.playing}>{d.playing ? "● LIVE" : "❚❚ PAUSED"} · {d.scenario.name} · {(d.simVersion, (d.sim.state.t / 1000).toFixed(1))}s{(d.simVersion, d.sim.state.inCombat) ? " · IN COMBAT" : ""}</div>{/if}
    {#each items as it (it.entry.key)}
      {@const e = it.entry}
      {@const n = d.scene.nodes[e.id]}
      {@const r = e.rect}
      {@const rs = (d.simVersion, d.preview && n?.bind ? resolve(d.sim.state, n.bind, e.unit) : null)}
      {#if n}
        {@const live = e.copy === 0 && !e.dim}
        {@const gone = d.preview && !(d.simVersion, visibleChain(d.scene, e.id, e.unit, d.sim.state))}
        {@const halo = n.blend === "ADD" && n.kind === "texture"}
        {@const z = d.zoom}
        {@const tex = n.kind === "texture" ? assets.image(n.texture) : null}
        {@const barTex = n.kind === "statusbar" ? assets.image(n.texture) : null}
        {@const fam = n.kind === "fontstring" || n.kind === "button" ? assets.font(n.font) : null}
        {@const shadows = [n.border ? `0 0 0 ${n.border.size * z}px ${css(n.border.color)}` : "", n.shadow ? `0 0 0 ${n.shadow.size * z}px rgba(0,0,0,${n.shadow.alpha})` : "", halo ? `inset 0 0 ${14 * z}px 0 ${css(rs?.tint ?? n.color)}` : ""].filter(Boolean).join(",")}
        {@const anim = n.pulse && !gone && (halo ? (rs ? rs.visible : true) : true) ? `animation:${n.pulse.period / 2}s ease-in-out infinite alternate pulse;animation-play-state:${d.playing || !d.preview ? "running" : "paused"};--hi:${n.pulse.high};--lo:${n.pulse.low};` : ""}
        {@const bar = rs?.barColor ?? n.barColor}
        {@const bg = rs?.bgColor ?? n.color}
        {@const fill = rs?.fill ?? Math.max(0, Math.min(1, (n.value - n.min) / ((n.max - n.min) || 1)))}
        <div class="el {n.kind}" class:sel={d.selection === n.id && e.copy === 0} class:hid={n.hidden} class:err={d.solved.errors.has(n.id)} class:copy={e.copy > 0 || e.dim} class:proposed={d.proposal && d.proposedNames.has(n.name) && e.copy === 0}
          style="left:{px(r.l)};bottom:{px(r.b)};width:{px(r.w)};height:{px(r.h)};z-index:{it.z};opacity:{gone ? 0 : e.dim ? 0.3 : n.hidden ? 0.3 : (halo && rs && !rs.visible) ? 0 : n.alpha};
          {n.kind === 'fontstring' ? '' : halo ? 'background:transparent;mix-blend-mode:screen;' : `background:${n.kind === 'texture' && tex && !rs?.tint ? `url(${tex}) 0 0 / 100% 100% no-repeat` : n.kind === 'texture' && n.texture && !rs?.tint ? 'repeating-conic-gradient(#2a2f40 0% 25%, #1d2130 0% 50%) 50% / 12px 12px' : css(rs?.tint ?? bg)};`}{shadows ? `box-shadow:${shadows};` : ''}{anim}"
          onpointerdown={(ev) => (live || !d.preview) && down(ev, n.id)} role="button" tabindex="-1" title="{n.name}{e.unit ? ` · ${e.unit}` : ''} · {Math.round(r.w)}×{Math.round(r.h)} @ {Math.round(r.l)},{Math.round(r.b)}">
          {#if n.kind === "statusbar"}
            <div class="fill" style="width:{fill * 100}%;background-color:{css(bar)};{barTex ? `background-image:url(${barTex});background-size:${r.w * z}px 100%;background-repeat:no-repeat;background-blend-mode:multiply;` : ""}"></div>
          {/if}
          {#if n.kind === "button"}<span class="lbl" style="font-size:{px(n.fontSize)};color:#fff;{fam ? `font-family:'${fam}',sans-serif;` : ""}">{n.text}</span>{/if}
          {#if n.kind === "fontstring"}
            <span class="txt" style="font-size:{px(n.fontSize)};color:{css(n.color)};{fam ? `font-family:'${fam}',sans-serif;` : ""}text-align:{n.justify.toLowerCase()};justify-content:{n.justify === 'RIGHT' ? 'flex-end' : n.justify === 'CENTER' ? 'center' : 'flex-start'};{n.outline ? 'text-shadow:0 0 2px #000,0 0 2px #000,1px 1px 0 #000;' : ''}">{rs?.text ?? n.text}</span>
            {#if rs?.secret}<i class="secret" title={rs.secret === "measured" ? "Secret in combat on Forever (measured for this unit). Needs a game test." : "Likely secret in combat on Forever (measured only for player/target). Needs a game test."}></i>{/if}
          {/if}
          {#if n.kind === "texture" && n.texture && !tex && !rs?.tint}<span class="tx">{n.texture.split(/[\\/]/).pop()}</span>{/if}
        </div>
      {/if}
    {/each}
    {#if d.selected}
      {@const r = d.solved.rects.get(d.selected.id)}
      {#if r}
        <div class="selbox" style="left:{px(r.l)};bottom:{px(r.b)};width:{px(r.w)};height:{px(r.h)}">
          {#each handles as h (h)}<button class="h" aria-label="resize {h}" style="{hpos(h, r)};cursor:{cursors[h]}-resize" onpointerdown={(e) => downHandle(e, h)}></button>{/each}
          <div class="dims">{Math.round(r.w)}×{Math.round(r.h)}</div>
        </div>
      {/if}
    {/if}
    {#each d.guides as g, i (i)}
      {#if g.axis === "x"}<div class="guide gx" style="left:{px(g.pos)}"></div>{:else}<div class="guide gy" style="bottom:{px(g.pos)}"></div>{/if}
    {/each}
  </div>
</div>

<style>
  .vp { flex: 1; min-width: 0; min-height: 0; overflow: auto; display: grid; place-items: center; background: #090a0e; background-image: radial-gradient(circle at 1px 1px, #1a1d27 1px, transparent 0); background-size: 18px 18px; padding: 24px; }
  .screen { position: relative; flex: none; background-color: #0e1016; outline: 1px solid #2d3242; box-shadow: 0 10px 60px #000a; overflow: hidden; }
  .uip { position: absolute; left: 8px; top: 6px; font: 10.5px var(--mono); color: #3d4560; pointer-events: none; z-index: 0; }
  .el { position: absolute; box-sizing: border-box; cursor: move; touch-action: none; }
  .el:hover { outline: 1px solid #22d3ee66; }
  .el.sel { outline: 1px solid var(--cyan); }
  .el.err { outline: 1px dashed var(--red); }
  .el.hid { outline: 1px dashed #566078; }
  .el.proposed { outline: 2px dashed var(--violet); outline-offset: 1px; }
  .el.copy { cursor: default; } .el.copy:hover { outline: none; }
  @keyframes pulse { from { opacity: var(--hi); } to { opacity: var(--lo); } }
  .secret { position: absolute; right: 1px; top: 1px; width: 5px; height: 5px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 4px var(--amber); pointer-events: none; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; pointer-events: none; }
  .lbl, .txt, .tx { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: hidden; white-space: nowrap; font-family: Georgia, "Times New Roman", serif; }
  .txt { justify-content: flex-start; } .tx { font: 10px var(--mono); color: #6f7893; }
  .live { position: absolute; right: 8px; bottom: 6px; font: 10.5px var(--mono); color: #6f7893; z-index: 9800; pointer-events: none; } .live.on { color: var(--green); }
  .selbox { position: absolute; z-index: 9000; pointer-events: none; box-shadow: 0 0 0 1px var(--cyan); }
  .h { position: absolute; width: 9px; height: 9px; margin: -4.5px; background: #0b0c10; border: 1.5px solid var(--cyan); border-radius: 2px; pointer-events: auto; padding: 0; }
  .h:hover { background: var(--cyan); }
  .dims { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 6px); background: #161922; border: 1px solid #2d3242; color: var(--cyan); font: 10.5px var(--mono); padding: 1px 6px; border-radius: 4px; white-space: nowrap; }
  .guide { position: absolute; z-index: 9500; pointer-events: none; background: var(--violet); box-shadow: 0 0 6px #8b6cff; }
  .gx { top: 0; bottom: 0; width: 1px; } .gy { left: 0; right: 0; height: 1px; }
</style>
