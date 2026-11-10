<script lang="ts">
  import { designer as d, RESOLUTIONS } from "../lib/designer.svelte";
  import { store } from "../lib/store.svelte";
  import { KINDS } from "../lib/scene";
  import Canvas from "./Canvas.svelte";
  import Inspector from "./Inspector.svelte";
  import Hierarchy from "./Hierarchy.svelte";

  let leftTab = $state<"layers" | "add">("add");
  let newName = $state("");
  const resKey = $derived(`${d.scene.resolution.w}x${d.scene.resolution.h}`);
  const kindLabel: Record<string, string> = { frame: "Frame", button: "Button", texture: "Texture", fontstring: "Text", statusbar: "Status bar" };
  const kindHint: Record<string, string> = { frame: "Container with a background", button: "Clickable frame with label", texture: "Solid color or texture file", fontstring: "Font string", statusbar: "Health / power / progress / cast bar" };
  function setRes(v: string) { const [w, h] = v.split("x").map(Number); if (w && h) d.setResolution(w, h); }
  $effect(() => { const f = d.sceneFiles; if (store.project && !d.path && f.length) void d.load(f[0]!); });
  const lines = $derived(d.generated.lua.split("\n"));
</script>

<div class="wrap">
  <div class="tb">
    <select class="text sel" value={d.path ?? ""} onchange={(e) => e.currentTarget.value && d.load(e.currentTarget.value)} title="Scene file">
      {#if d.path && !d.sceneFiles.includes(d.path)}<option value={d.path}>{d.path} (unsaved)</option>{/if}
      {#if !d.path}<option value="">no scene</option>{/if}
      {#each d.sceneFiles as f (f)}<option value={f}>{f}</option>{/each}
    </select>
    <input class="text nm" placeholder="New scene name" bind:value={newName} /><button class="btn" onclick={() => { d.newSceneFlow(newName || "MainUI"); newName = ""; }}>New</button>
    <span class="sep"></span>
    <button class="btn ghost" disabled={!d.canUndo} onclick={() => d.undo()} title="Undo (Ctrl+Z)">↶</button>
    <button class="btn ghost" disabled={!d.canRedo} onclick={() => d.redo()} title="Redo (Ctrl+Y)">↷</button>
    <span class="sep"></span>
    <select class="text sel2" value={resKey} onchange={(e) => setRes(e.currentTarget.value)} title="Screen resolution">
      {#each RESOLUTIONS as [label, w, h] (label)}<option value="{w}x{h}">{label}</option>{/each}
      {#if !RESOLUTIONS.some(([, w, h]) => w === d.scene.resolution.w && h === d.scene.resolution.h)}<option value={resKey}>{d.scene.resolution.w}×{d.scene.resolution.h}</option>{/if}
    </select>
    <label class="lab" title="UI scale: UIParent logical size = resolution ÷ scale">UI scale <input type="range" min="0.5" max="1.5" step="0.05" value={d.scene.uiScale} oninput={(e) => d.edit(() => { d.scene.uiScale = parseFloat(e.currentTarget.value); })} /> <b>{d.scene.uiScale.toFixed(2)}</b></label>
    <label class="lab">Zoom <input type="range" min="0.1" max="3" step="0.05" value={d.zoom} oninput={(e) => { d.fit = false; d.zoom = parseFloat(e.currentTarget.value); }} /> <b>{Math.round(d.zoom * 100)}%</b></label>
    <button class="btn ghost" class:on={d.fit} onclick={() => (d.fit = true)}>Fit</button>
    <span class="sep"></span>
    <label class="chk"><input type="checkbox" bind:checked={d.snap} /> Snap</label>
    <label class="chk"><input type="checkbox" bind:checked={d.showGrid} /> Grid <input class="text g" type="number" min="1" max="128" bind:value={d.grid} /></label>
    <span class="grow"></span>
    <button class="btn ghost" class:on={d.showCode} onclick={() => (d.showCode = !d.showCode)}>Lua preview</button>
    <button class="btn" onclick={() => d.save()} disabled={!d.dirty && !!d.path}>Save{d.dirty ? " ●" : ""}</button>
    <button class="btn primary" onclick={() => d.generateFiles()}>Generate Lua + XML</button>
  </div>

  <div class="body">
    <aside class="left">
      <div class="panel-h"><button class="tabbtn" class:on={leftTab === "add"} onclick={() => (leftTab = "add")}>Add</button><button class="tabbtn" class:on={leftTab === "layers"} onclick={() => (leftTab = "layers")}>Hierarchy</button></div>
      {#if leftTab === "add"}
        <div class="scroll pal">
          <h4>Elements</h4>
          {#each KINDS as k (k)}<button class="pi" onclick={() => d.add(k)}><b>{kindLabel[k]}</b><span class="faint">{kindHint[k]}</span></button>{/each}
          <h4>Templates</h4>
          {#each d.templates as t (t.id)}<button class="pi" onclick={() => d.addTemplate(t)}><b>{t.name}</b><span class="faint">{t.builtIn ? "built-in" : "scene"} · {t.nodes.length} elements</span></button>{/each}
          <p class="faint small">New elements go inside the selected frame. Drag elements in the Hierarchy tab to re-parent them.</p>
        </div>
      {:else}<Hierarchy />{/if}
    </aside>
    <main class="center">
      <Canvas />
      {#if d.showCode}
        <div class="code">
          <div class="ch"><b>{d.generated.luaPath}</b><span class="faint">generated live from the scene · written only by “Generate”</span>
            {#if d.generated.warnings.length}<span class="badge amber" title={d.generated.warnings.join("\n")}>{d.generated.warnings.length} warning{d.generated.warnings.length > 1 ? "s" : ""}</span>{/if}</div>
          <pre class="scroll mono">{#each lines as l, i (i)}<span class="ln">{i + 1}</span>{l}{"\n"}{/each}</pre>
        </div>
      {/if}
    </main>
    <aside class="right"><div class="panel-h"><span class="tabbtn on">Properties</span></div><Inspector /></aside>
  </div>
  <div class="note">Approximate canvas: positions, anchors, sizes and layering follow the client's rules; fonts and game textures are placeholders. Behaviour is not simulated.</div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; }
  .tb { display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: var(--panel); border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .sel { width: 170px; } .nm { width: 110px; } .sel2 { width: 130px; } .sep { width: 1px; height: 20px; background: var(--border); } .grow { flex: 1; }
  .lab { display: flex; gap: 6px; align-items: center; color: var(--dim); font-size: 12px; } .lab input { width: 64px; accent-color: var(--violet); } .lab b { color: var(--text); font-weight: 500; min-width: 36px; }
  .chk { display: flex; gap: 6px; align-items: center; color: var(--dim); font-size: 12px; } input.g { width: 54px; padding: 2px 6px; }
  .btn.on { color: var(--cyan); }
  .body { display: flex; flex: 1; min-height: 0; }
  .left { width: 230px; flex: none; display: flex; flex-direction: column; background: var(--panel); border-right: 1px solid var(--border); min-height: 0; }
  .right { width: 310px; flex: none; display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--border); min-height: 0; }
  .center { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .pal { padding: 6px 8px; flex: 1; } .pal h4 { margin: 10px 0 6px; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  .pi { display: flex; flex-direction: column; width: 100%; text-align: left; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 5px; background: var(--panel2); }
  .pi:hover { border-color: #8b6cff88; background: #1d1a3a; } .pi b { font-weight: 500; } .pi span { font-size: 11px; } .small { font-size: 11px; }
  .code { height: 200px; flex: none; border-top: 1px solid var(--border); display: flex; flex-direction: column; background: var(--bg); }
  .ch { display: flex; gap: 12px; align-items: center; padding: 5px 12px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .code pre { margin: 0; padding: 6px 0; flex: 1; font-size: 11.5px; line-height: 1.5; color: #bfc4d6; }
  .ln { display: inline-block; width: 38px; text-align: right; padding-right: 12px; color: #3e4354; user-select: none; }
  .note { padding: 3px 12px; font-size: 11px; color: var(--faint); background: var(--panel); border-top: 1px solid var(--border); }
</style>
