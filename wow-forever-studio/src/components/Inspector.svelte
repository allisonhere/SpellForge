<script lang="ts">
  import { designer as d } from "../lib/designer.svelte";
  import { LAYERS, POINTS, STRATA, setName, isContainer, type Rgba, type SceneNode } from "../lib/scene";
  import { SUPPORT } from "../lib/sim/bind";

  const n = $derived(d.selected);
  const sibs = $derived(n ? d.scene.order.map((i) => d.scene.nodes[i]!).filter((x) => x.id !== n.id && x.parent === n.parent) : []);
  const twoH = $derived(!!n && n.anchors.some((a) => a.point.endsWith("LEFT")) && n.anchors.some((a) => a.point.endsWith("RIGHT")));
  const twoV = $derived(!!n && n.anchors.some((a) => a.point.startsWith("TOP")) && n.anchors.some((a) => a.point.startsWith("BOTTOM")));
  const hex = (c: Rgba) => "#" + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  const fromHex = (c: Rgba, h: string) => { c[0] = parseInt(h.slice(1, 3), 16) / 255; c[1] = parseInt(h.slice(3, 5), 16) / 255; c[2] = parseInt(h.slice(5, 7), 16) / 255; };
  const numv = (v: string, f = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : f; };
  const set = <K extends keyof SceneNode>(k: K, v: SceneNode[K]) => d.edit(() => { if (n) n[k] = v; });
  let tname = $state("");
  const stats = $derived(n ? Object.entries(SUPPORT).filter(([, v]) => v.kinds.includes(n.kind)) : []);
  const units = ["$unit", "player", "target", "party1", "party2", "party3", "party4", "raid1", "raid2", "raid20", "raid40"];
</script>

{#if !n}
  <div class="empty">Select an element on the canvas or in the hierarchy.<br /><span class="small">Arrow keys nudge 1px (Shift 10px) · Alt disables snapping · Ctrl+Z / Ctrl+Y undo / redo</span></div>
{:else}
  <div class="scroll body">
    <div class="sec">
      <h4>Identity</h4>
      <div class="g2"><label>Name<input class="text" value={n.name} onchange={(e) => d.edit(() => setName(d.scene, n.id, e.currentTarget.value), true)} /></label>
        <label>Type<input class="text" value={n.kind} disabled /></label></div>
      <label class="chk"><input type="checkbox" checked={n.global} onchange={(e) => set("global", e.currentTarget.checked)} /> Global frame name <span class="faint">(visible to /fstack and other addons)</span></label>
    </div>

    <div class="sec">
      <h4>Anchors <span class="faint">(WoW: y grows upward)</span></h4>
      {#each n.anchors as a, i (i)}
        <div class="anc">
          <div class="g3">
            <select class="text" value={a.point} onchange={(e) => d.edit(() => { a.point = e.currentTarget.value as typeof a.point; }, true)}>{#each POINTS as p (p)}<option>{p}</option>{/each}</select>
            <select class="text" value={a.relTo ?? ""} onchange={(e) => d.edit(() => { a.relTo = e.currentTarget.value || null; }, true)}>
              <option value="">{n.parent ? "parent" : "UIParent"}</option>{#each sibs as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
            </select>
            <select class="text" value={a.relPoint} onchange={(e) => d.edit(() => { a.relPoint = e.currentTarget.value as typeof a.relPoint; }, true)}>{#each POINTS as p (p)}<option>{p}</option>{/each}</select>
          </div>
          <div class="g3b">
            <label>X<input class="text" type="number" value={a.x} oninput={(e) => d.edit(() => { a.x = numv(e.currentTarget.value); })} /></label>
            <label>Y<input class="text" type="number" value={a.y} oninput={(e) => d.edit(() => { a.y = numv(e.currentTarget.value); })} /></label>
            <button class="btn ghost" title="Remove anchor" onclick={() => d.edit(() => n.anchors.splice(i, 1), true)}>×</button>
          </div>
        </div>
      {/each}
      {#if !n.anchors.length}<div class="warn">No anchor: the client will not position this element.</div>{/if}
      <button class="btn" onclick={() => d.edit(() => n.anchors.push({ point: "TOPLEFT", relTo: null, relPoint: "TOPLEFT", x: 0, y: 0 }), true)}>+ Anchor</button>
    </div>

    <div class="sec">
      <h4>Size</h4>
      <div class="g2">
        <label>Width<input class="text" type="number" value={Math.round(d.solved.rects.get(n.id)?.w ?? n.width)} disabled={twoH} oninput={(e) => d.edit(() => { n.width = Math.max(0, numv(e.currentTarget.value)); })} /></label>
        <label>Height<input class="text" type="number" value={Math.round(d.solved.rects.get(n.id)?.h ?? n.height)} disabled={twoV} oninput={(e) => d.edit(() => { n.height = Math.max(0, numv(e.currentTarget.value)); })} /></label>
      </div>
      {#if twoH || twoV}<div class="faint small">Size comes from two opposing anchors, exactly as the client computes it.</div>{/if}
    </div>

    <div class="sec">
      <h4>Layering</h4>
      {#if n.kind === "texture" || n.kind === "fontstring"}
        <label>Draw layer<select class="text" value={n.layer} onchange={(e) => set("layer", e.currentTarget.value as typeof n.layer)}>{#each LAYERS as l (l)}<option>{l}</option>{/each}</select></label>
      {:else}
        <div class="g2"><label>Frame strata<select class="text" value={n.strata} onchange={(e) => set("strata", e.currentTarget.value as typeof n.strata)}>{#each STRATA as s (s)}<option>{s}</option>{/each}</select></label>
          <label>Level (+)<input class="text" type="number" value={n.level} oninput={(e) => d.edit(() => { n.level = Math.round(numv(e.currentTarget.value)); })} /></label></div>
      {/if}
      <div class="g2"><label>Opacity<input type="range" min="0" max="1" step="0.01" value={n.alpha} oninput={(e) => d.edit(() => { n.alpha = numv(e.currentTarget.value, 1); })} /></label>
        <label class="chk"><input type="checkbox" checked={n.hidden} onchange={(e) => set("hidden", e.currentTarget.checked)} /> Hidden on load</label></div>
    </div>

    <div class="sec">
      <h4>Appearance</h4>
      <div class="g2">
        <label>{n.kind === "fontstring" ? "Text color" : n.kind === "statusbar" ? "Background" : "Color"}
          <input class="text color" type="color" value={hex(n.color)} oninput={(e) => d.edit(() => fromHex(n.color, e.currentTarget.value))} /></label>
        <label>Color alpha<input type="range" min="0" max="1" step="0.01" value={n.color[3]} oninput={(e) => d.edit(() => { n.color[3] = numv(e.currentTarget.value, 1); })} /></label>
      </div>
      {#if n.kind === "fontstring" || n.kind === "button"}
        <label>Text<input class="text" value={n.text} oninput={(e) => d.edit(() => { n.text = e.currentTarget.value; })} /></label>
        <div class="g2"><label>Font size<input class="text" type="number" value={n.fontSize} oninput={(e) => d.edit(() => { n.fontSize = Math.max(4, numv(e.currentTarget.value, 12)); })} /></label>
          <label>Outline<select class="text" value={n.outline} onchange={(e) => set("outline", e.currentTarget.value as typeof n.outline)}><option value="">none</option><option>OUTLINE</option><option>THICKOUTLINE</option></select></label></div>
        {#if n.kind === "fontstring"}<label>Justify<select class="text" value={n.justify} onchange={(e) => set("justify", e.currentTarget.value as typeof n.justify)}><option>LEFT</option><option>CENTER</option><option>RIGHT</option></select></label>{/if}
        <label>Font file<input class="text mono" value={n.font} onchange={(e) => set("font", e.currentTarget.value)} /></label>
      {/if}
      {#if n.kind === "texture"}<label>Texture path <span class="faint">(empty = solid color)</span><input class="text mono" value={n.texture} placeholder="Interface\Icons\INV_Misc_QuestionMark" onchange={(e) => set("texture", e.currentTarget.value)} /></label>{/if}
      {#if n.kind === "statusbar"}
        <div class="g3b"><label>Min<input class="text" type="number" value={n.min} oninput={(e) => d.edit(() => { n.min = numv(e.currentTarget.value); })} /></label>
          <label>Max<input class="text" type="number" value={n.max} oninput={(e) => d.edit(() => { n.max = numv(e.currentTarget.value, 100); })} /></label>
          <label>Value<input class="text" type="number" value={n.value} oninput={(e) => d.edit(() => { n.value = numv(e.currentTarget.value); })} /></label></div>
        <label>Bar color<input class="text color" type="color" value={hex(n.barColor)} oninput={(e) => d.edit(() => fromHex(n.barColor, e.currentTarget.value))} /></label>
        <label>Bar texture<input class="text mono" value={n.texture} onchange={(e) => set("texture", e.currentTarget.value)} /></label>
      {/if}
      <p class="faint small">Canvas text uses a system font; in game the font file above is used, so widths differ slightly. Game textures are shown as placeholders.</p>
    </div>

    <div class="sec">
      <h4>Edge, shadow & animation</h4>
      {#if isContainer(n.kind)}
        <label class="chk"><input type="checkbox" checked={!!n.border} onchange={(e) => d.edit(() => { if (e.currentTarget.checked) n.border = { size: 1, color: [0, 0, 0, 1] }; else delete n.border; }, true)} /> Border</label>
        {#if n.border}<div class="g2"><label>Size px<input class="text" type="number" min="1" value={n.border.size} onchange={(e) => d.edit(() => { n.border!.size = Math.max(1, Math.round(numv(e.currentTarget.value, 1))); }, true)} /></label>
          <label>Colour<input class="text color" type="color" value={hex(n.border.color)} oninput={(e) => d.edit(() => fromHex(n.border!.color, e.currentTarget.value))} /></label></div>{/if}
        <label class="chk"><input type="checkbox" checked={!!n.shadow} onchange={(e) => d.edit(() => { if (e.currentTarget.checked) n.shadow = { size: 3, alpha: 0.45 }; else delete n.shadow; }, true)} /> Shadow <span class="faint">(dark rect beyond the edge)</span></label>
        {#if n.shadow}<div class="g2"><label>Size px<input class="text" type="number" min="1" value={n.shadow.size} onchange={(e) => d.edit(() => { n.shadow!.size = Math.max(1, Math.round(numv(e.currentTarget.value, 3))); }, true)} /></label>
          <label>Alpha<input type="range" min="0" max="1" step="0.01" value={n.shadow.alpha} oninput={(e) => d.edit(() => { n.shadow!.alpha = numv(e.currentTarget.value, 0.45); })} /></label></div>{/if}
      {/if}
      {#if n.kind === "texture"}<label>Blend mode<select class="text" value={n.blend ?? "BLEND"} onchange={(e) => set("blend", e.currentTarget.value as "BLEND" | "ADD")}><option>BLEND</option><option>ADD</option></select></label>{/if}
      <label class="chk"><input type="checkbox" checked={!!n.pulse} onchange={(e) => d.edit(() => { if (e.currentTarget.checked) n.pulse = { high: 1, low: 0.3, period: 1.1 }; else delete n.pulse; }, true)} /> Pulse (looping alpha bounce)</label>
      {#if n.pulse}<div class="g3b"><label>High<input class="text" type="number" step="0.05" min="0" max="1" value={n.pulse.high} onchange={(e) => d.edit(() => { n.pulse!.high = numv(e.currentTarget.value, 1); }, true)} /></label>
        <label>Low<input class="text" type="number" step="0.05" min="0" max="1" value={n.pulse.low} onchange={(e) => d.edit(() => { n.pulse!.low = numv(e.currentTarget.value, 0.3); }, true)} /></label>
        <label>Period s<input class="text" type="number" step="0.1" min="0.1" value={n.pulse.period} onchange={(e) => d.edit(() => { n.pulse!.period = Math.max(0.1, numv(e.currentTarget.value, 1.1)); }, true)} /></label></div>{/if}
    </div>

    <div class="sec">
      <h4>Simulation binding <span class="faint">(preview only)</span></h4>
      <label>Drive from
        <select class="text" value={n.bind?.stat ?? ""} onchange={(e) => d.edit(() => { const v = e.currentTarget.value; if (!v) delete n.bind; else n.bind = { ...(n.bind ?? { unit: "$unit" }), stat: v }; }, true)}>
          <option value="">none (static)</option>{#each stats as [k, v] (k)}<option value={k}>{k} — {v.summary}</option>{/each}
        </select></label>
      {#if n.bind}
        <div class="g2">
          <label>Unit<input class="text mono" list="unitlist" value={n.bind.unit} onchange={(e) => d.edit(() => { n.bind!.unit = e.currentTarget.value || "$unit"; }, true)} /></label>
          <label>Slot<input class="text" type="number" min="0" value={n.bind.slot ?? 0} onchange={(e) => d.edit(() => { n.bind!.slot = Math.max(0, Math.round(numv(e.currentTarget.value))); }, true)} /></label>
        </div>
        <datalist id="unitlist">{#each units as u (u)}<option value={u}></option>{/each}</datalist>
        {#if n.bind.stat === "health"}<label>Colour by<select class="text" value={n.bind.colorBy ?? "class"} onchange={(e) => d.edit(() => { n.bind!.colorBy = e.currentTarget.value as "class" | "classBar" | "threshold" | "none"; }, true)}><option value="class">class / reaction (bar + 18% background)</option><option value="classBar">class (bar only)</option><option value="threshold">health threshold</option><option value="none">keep my colours</option></select></label>{/if}
        {#if n.bind.stat === "auraIcon" || n.bind.stat === "auraTime" || n.bind.stat === "auraStacks"}<label>Aura type<select class="text" value={n.bind.aura ?? ""} onchange={(e) => d.edit(() => { const v = e.currentTarget.value; if (v) n.bind!.aura = v as "buff" | "debuff"; else delete n.bind!.aura; }, true)}><option value="">any</option><option value="buff">buff</option><option value="debuff">debuff</option></select></label>{/if}
        {#if n.bind.stat === "lowHealth"}<label>Below health %<input class="text" type="number" value={n.bind.threshold ?? 35} onchange={(e) => d.edit(() => { n.bind!.threshold = numv(e.currentTarget.value, 35); }, true)} /></label>{/if}
        <p class="faint small">{SUPPORT[n.bind.stat]?.summary ?? "Unknown binding"}. Bindings are never written into generated game code.</p>
      {/if}
    </div>

    {#if isContainer(n.kind)}
      <div class="sec">
        <h4>Group / raid repeater <span class="faint">(preview only)</span></h4>
        <label class="chk"><input type="checkbox" checked={!!n.repeat} onchange={(e) => d.edit(() => { if (e.currentTarget.checked) n.repeat = { kind: "party", count: 0, columns: 1, gapX: 4, gapY: 4 }; else delete n.repeat; }, true)} /> Repeat this frame per unit</label>
        {#if n.repeat}
          <div class="g2"><label>Group<select class="text" value={n.repeat.kind} onchange={(e) => d.edit(() => { n.repeat!.kind = e.currentTarget.value as "party" | "raid"; }, true)}><option value="party">party (party1–4)</option><option value="raid">raid (raid1–40)</option></select></label>
            <label>Count (0 = scenario)<input class="text" type="number" min="0" max="40" value={n.repeat.count} onchange={(e) => d.edit(() => { n.repeat!.count = Math.max(0, Math.min(40, Math.round(numv(e.currentTarget.value)))); }, true)} /></label></div>
          <div class="g3b"><label>Columns<input class="text" type="number" min="1" value={n.repeat.columns} onchange={(e) => d.edit(() => { n.repeat!.columns = Math.max(1, Math.round(numv(e.currentTarget.value, 1))); }, true)} /></label>
            <label>Gap X<input class="text" type="number" value={n.repeat.gapX} onchange={(e) => d.edit(() => { n.repeat!.gapX = numv(e.currentTarget.value); }, true)} /></label>
            <label>Gap Y<input class="text" type="number" value={n.repeat.gapY} onchange={(e) => d.edit(() => { n.repeat!.gapY = numv(e.currentTarget.value); }, true)} /></label></div>
          <p class="faint small">Turn on <b>Preview</b> to see the grid for the active scenario. Use <span class="mono">$unit</span> in child bindings.</p>
        {/if}
      </div>
    {/if}

    <div class="sec">
      <h4>Template</h4>
      <div class="row"><input class="text" placeholder="Template name" bind:value={tname} /><button class="btn" disabled={!tname} onclick={() => { d.makeTemplate(tname); tname = ""; }}>Save selection</button></div>
    </div>
  </div>
{/if}

<style>
  .body { flex: 1; } label { display: grid; gap: 3px; color: var(--dim); font-size: 11.5px; margin-bottom: 8px; }
  .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; } .g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-bottom: 4px; }
  .g3b { display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; align-items: end; }
  .chk { display: flex; gap: 8px; align-items: center; } .small { font-size: 11px; } .warn { color: var(--amber); font-size: 12px; margin-bottom: 6px; }
  .anc { padding: 6px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; background: var(--bg); }
  input.color { padding: 0; height: 28px; } select.text { padding: 4px 4px; font-size: 11px; } input[type="range"] { accent-color: var(--violet); }
  :global(input.text.mono) { font-family: var(--mono); font-size: 11px; }
</style>
