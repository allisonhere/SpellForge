<script lang="ts">
  import Modal from "./Modal.svelte";
  import { ipc } from "../lib/ipc";
  import { store } from "../lib/store.svelte";
  import { studio } from "../lib/ai/studio.svelte";
  import type { AiProvider } from "../lib/types";
  import { onMount } from "svelte";
  let models = $state<Record<string, string[]>>({}); let aiErr = $state("");
  onMount(() => { void studio.refresh(); });
  async function aiToggle(on: boolean) { try { await ipc.aiSetEnabled(on); await studio.refresh(); aiErr = ""; } catch (e) { aiErr = String(e); } }
  async function saveProv(p: AiProvider) { try { await ipc.aiSaveProvider(p); await studio.refresh(); aiErr = ""; } catch (e) { aiErr = String(e); } }
  async function refreshModels(p: AiProvider) { try { models[p.id] = await ipc.aiListModels(p.id); aiErr = ""; } catch (e) { aiErr = String(e); } }

  async function add() { try { store.installations = await ipc.addInstallation(); store.say("ok", "Installation list updated"); } catch (e) { store.fail(e); } }
  async function rm(id: string) { store.installations = await ipc.removeInstallation(id); }
  async function reload() { store.api = JSON.parse(await ipc.apiIndex()); store.apiOrigin = (await ipc.boot()).apiOrigin; }
  async function imp() {
    try { const b = await ipc.importApi(); if (b) { await reload(); store.say("ok", `Imported API snapshot build ${b}`); } } catch (e) { store.fail(e); }
  }
  async function reset() { await ipc.resetApi(); await reload(); store.say("ok", "Restored bundled API snapshot"); }
</script>

<Modal title="Settings" onclose={() => (store.modal = null)} width={680}>
  <div class="sec">
    <h4>WoW installations (deploy targets)</h4>
    {#each store.installations as i (i.id)}
      <div class="row ins"><b>{i.name}</b><span class="mono faint grow">{i.addonsDir}</span><button class="btn ghost danger" onclick={() => rm(i.id)}>Remove</button></div>
    {/each}
    {#if !store.installations.length}<p class="faint">No installations configured. Nothing is ever written to a game folder you have not added here.</p>{/if}
    <div class="row"><button class="btn" onclick={add}>Add installation…</button></div>
    {#if store.detected.length}
      <p class="muted small">Folders found on this machine (not added automatically; use “Add installation” and pick one):</p>
      {#each store.detected as d (d.addonsDir)}<div class="mono faint small">{d.addonsDir}</div>{/each}
    {/if}
  </div>
  <div class="sec">
    <h4>API snapshot</h4>
    {#if store.api}
      <div class="mono small">build {store.api.meta.build} · version {store.api.meta.version} · interface {store.api.meta.interface} · exported {store.api.meta.exportedAt} · <span class="badge violet">{store.apiOrigin}</span></div>
      {#each store.api.meta.sources as s (s.file)}
        <div class="src"><b>{s.file}</b> <span class="faint">{s.kind}</span><br /><span class="faint small">{s.origin} @ {s.commit.slice(0, 8)} · sha256 {s.sha256.slice(0, 12)}…</span><br /><span class="faint small">License: {s.license}</span></div>
      {/each}
    {/if}
    <div class="row gap"><button class="btn" onclick={imp}>Import snapshot from file…</button><button class="btn ghost" onclick={reset} disabled={store.apiOrigin === "bundled"}>Restore bundled</button></div>
    <p class="faint small">Imports a compiled <span class="mono">forever-api-index.json</span> (schema 1). Build one from a raw export with <span class="mono">npm run api:build</span>. No network access is used.</p>
  </div>
  <div class="sec">
    <h4>AI assistant (optional)</h4>
    <label class="chk"><input type="checkbox" checked={studio.status?.enabled ?? false} onchange={(e) => aiToggle(e.currentTarget.checked)} /> Enable the AI assistant</label>
    <p class="muted small">Off by default. While off, no AI network request is ever made. Local providers can only connect to this machine (enforced in the app's backend, not just the UI). Nothing about your project is sent unless you use the Create tab.</p>
    {#each studio.status?.providers ?? [] as p (p.id)}
      <div class="prov">
        <label class="chk"><input type="checkbox" checked={p.enabled} disabled={!studio.status?.enabled} onchange={(e) => saveProv({ ...p, enabled: e.currentTarget.checked })} /> <b>{p.name}</b> <span class="faint mono">{p.baseUrl}</span></label>
        {#if p.enabled && studio.status?.enabled}
          <div class="row">
            <select class="text" value={p.model} onchange={(e) => saveProv({ ...p, model: e.currentTarget.value })}>
              <option value="">choose a model…</option>
              {#each (models[p.id] ?? (p.model ? [p.model] : [])) as m (m)}<option value={m}>{m}</option>{/each}
            </select>
            <button class="btn" onclick={() => refreshModels(p)}>Refresh models</button>
          </div>
        {/if}
      </div>
    {/each}
    {#if aiErr}<div class="err small">{aiErr}</div>{/if}
    <p class="faint small">Ollama: start it with <span class="mono">ollama serve</span> and pull a model (for example <span class="mono">ollama pull qwen2.5-coder:14b</span>). Cloud providers are not available in this build.</p>
  </div>
  <div class="sec">
    <h4>Privacy</h4>
    <p class="muted small">No telemetry, accounts or online services. Nothing leaves this machine unless you enable the AI assistant with a provider that you configure.</p>
  </div>
</Modal>

<style>
  .ins { padding: 4px 0; } .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; } .small { font-size: 11.5px; } .gap { margin-top: 10px; }
  .prov { margin: 8px 0; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); display: grid; gap: 6px; } .chk { display: flex; gap: 8px; align-items: center; } .err { color: var(--red); margin-top: 6px; }
  .src { margin: 8px 0; padding-left: 10px; border-left: 2px solid var(--border2); }
</style>
