<script lang="ts">
  import { onMount } from "svelte";
  import { ipc, errText } from "../lib/ipc";
  import { store } from "../lib/store.svelte";
  import type { UiHit, UiResolved, UiStatus } from "../lib/types";
  import XNodeView from "./XNodeView.svelte";

  let status = $state<UiStatus | null>(null);
  let q = $state(""); let hits = $state<UiHit[]>([]); let sel = $state<UiHit | null>(null); let res = $state<UiResolved | null>(null);
  let busy = $state(false); let timer: ReturnType<typeof setTimeout>;

  onMount(async () => { try { status = await ipc.uiSourceStatus(); } catch (e) { store.fail(e); } });
  async function importIt() {
    busy = true;
    try { const s = await ipc.importUiSource(); if (s) { status = s; store.say("ok", `Imported Blizzard UI source build ${s.build}: ${s.templates} templates from ${s.addons} addons`); } }
    catch (e) { store.fail(e); } finally { busy = false; }
  }
  function search() {
    clearTimeout(timer);
    timer = setTimeout(async () => { try { hits = q.trim() ? await ipc.uiTemplateSearch(q) : []; } catch (e) { store.fail(e); } }, 150);
  }
  async function pick(h: UiHit) { sel = h; res = null; try { res = await ipc.uiTemplateResolve(h.name); } catch (e) { store.fail(errText(e)); } }
</script>

<div class="scroll body">
  {#if !status}
    <div class="sec">
      <h4>Blizzard UI source</h4>
      <p class="muted small">Import the real interface definitions (FrameXML) from a <b>local folder</b> to browse templates, resolve inheritance and, later, render them. The data stays on your machine and is never added to your project or redistributed.</p>
      <button class="btn primary" onclick={importIt} disabled={busy}>{busy ? "Indexing…" : "Import Blizzard UI source…"}</button>
      <p class="faint small">Pick the folder that contains <span class="mono">Interface/AddOns</span> (for example a checkout of Blizzard's published UI source for your build). Textures and fonts in the game client are encrypted in the current beta and cannot be read; see the compatibility notes.</p>
    </div>
  {:else}
    <div class="sec">
      <div class="row"><b>Build {status.build}</b><span class="badge green">Forever / camelot</span><span class="grow"></span><button class="btn ghost" onclick={importIt} disabled={busy}>Re-import</button></div>
      <div class="kv"><span>Templates</span><b>{status.templates.toLocaleString()} ({status.virtualTemplates.toLocaleString()} virtual)</b></div>
      <div class="kv"><span>Addons / XML files</span><b>{status.addons} / {status.xmlFiles}</b></div>
      <div class="kv"><span>Parse errors</span><b class:bad={status.parseErrors > 0}>{status.parseErrors}</b></div>
      <div class="kv"><span>Undefined inherited bases</span><b class:bad={status.undefinedBases.length > 0}>{status.undefinedBases.length}</b></div>
      {#if status.undefinedBases.length}<div class="faint small mono">{status.undefinedBases.join(", ")}</div>{/if}
      {#if status.unknownDirectives.length}<div class="faint small">TOC directives not yet interpreted: <span class="mono">{status.unknownDirectives.join(", ")}</span></div>{/if}
      <div class="faint small mono" title={status.root}>{status.root}</div>
    </div>
    <div class="sec">
      <input class="text" placeholder="Search templates (e.g. UIPanelButtonTemplate, StatusBar)" bind:value={q} oninput={search} />
      <div class="list">
        {#each hits as h (h.name + h.file)}
          <button class="r" class:act={sel?.name === h.name} onclick={() => pick(h)}><span class="badge {h.isVirtual ? 'cyan' : ''}">{h.tag}</span><span class="mono nm">{h.name}</span></button>
        {/each}
        {#if q && !hits.length}<div class="empty">No template matches in the imported source.</div>{/if}
      </div>
    </div>
    {#if sel}
      <div class="sec">
        <h4>{sel.name}</h4>
        <div class="faint small mono">{sel.file}:{sel.line}</div>
        {#if res}
          <div class="small"><span class="faint">inheritance (base → derived):</span> <span class="mono">{res.chain.join(" → ")}</span></div>
          {#if res.missing.length}<div class="warn small">Undefined base template(s): <span class="mono">{res.missing.join(", ")}</span>. These are not defined anywhere in the imported source, so the result is incomplete.</div>{/if}
          <div class="tree"><XNodeView n={res.node} /></div>
          <p class="faint small">Resolved with the merge rules in docs/NATIVE_UI.md. Rules marked INFERRED are not yet verified against the client.</p>
        {:else}<div class="faint">Resolving…</div>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .body { flex: 1; } .small { font-size: 11.5px; } .row { display: flex; align-items: center; gap: 8px; } .grow { flex: 1; }
  .kv { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; } .kv span { color: var(--faint); } .kv b { font-weight: 500; } .bad { color: var(--amber); }
  .list { margin-top: 6px; max-height: 220px; overflow: auto; } .r { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; padding: 3px 6px; border-radius: 5px; } .r:hover { background: var(--panel2); } .r.act { background: #2a2260; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .warn { color: var(--amber); margin: 6px 0; } .tree { margin: 8px 0; padding: 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; max-height: 360px; overflow: auto; }
</style>
