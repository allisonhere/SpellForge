<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { searchApi, type ApiKind, type ApiHit } from "../lib/apiSearch";

  let q = $state("");
  let kinds = $state<Record<ApiKind, boolean>>({ function: true, event: true, type: true, namespace: true });
  const hits = $derived(store.api ? searchApi(store.api, q, new Set((Object.keys(kinds) as ApiKind[]).filter((k) => kinds[k])), 150) : []);
  function pick(h: ApiHit) { store.selectedApi = h; store.ui.showRight = true; store.ui.rightTab = "docs"; store.persist(); }
  const tone: Record<ApiKind, string> = { function: "cyan", event: "amber", type: "violet", namespace: "green" };
</script>

<div class="top">
  <input id="api-q" class="text" placeholder="Search functions, events, types…  (e.g. C_Spell, UNIT_AURA)" bind:value={q} />
  <div class="chips">
    {#each Object.keys(kinds) as k (k)}
      <button class="chip" class:on={kinds[k as ApiKind]} onclick={() => (kinds[k as ApiKind] = !kinds[k as ApiKind])}>{k}</button>
    {/each}
  </div>
</div>
<div class="list scroll">
  {#each hits as h (h.kind + h.name)}
    <button class="r" class:act={store.selectedApi?.name === h.name && store.selectedApi?.kind === h.kind} onclick={() => pick(h)}>
      <span class="badge {tone[h.kind]}">{h.kind === "function" ? "fn" : h.kind.slice(0, 3)}</span>
      <span class="body"><span class="n">{h.name}</span><span class="s faint">{h.summary}</span></span>
      {#if h.kind === "function" && h.fn && !(h.fn.src & 1)}<span class="badge" title="Present in a capture, but parameters are undocumented">no sig</span>{/if}
    </button>
  {/each}
  {#if q && !hits.length}<div class="empty">No match in snapshot build {store.api?.meta.build}.<br />That does not prove it is unsupported.</div>{/if}
  {#if !q}<div class="empty">Offline index: {store.api?.meta.counts.functions?.toLocaleString()} functions, {store.api?.meta.counts.events?.toLocaleString()} events, {store.api?.meta.counts.types?.toLocaleString()} types<br />build {store.api?.meta.build} · exported {store.api?.meta.exportedAt}</div>{/if}
</div>

<style>
  .top { padding: 8px; display: grid; gap: 8px; border-bottom: 1px solid var(--border); }
  .chips { display: flex; gap: 4px; }
  .chip { font-size: 11px; padding: 2px 8px; border-radius: 99px; border: 1px solid var(--border2); color: var(--faint); }
  .chip.on { color: var(--text); border-color: #8b6cff88; background: #8b6cff1f; }
  .list { flex: 1; padding: 4px; }
  .r { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 5px 8px; border-radius: 6px; }
  .r:hover { background: var(--panel2); } .r.act { background: #2a2260; }
  .body { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .n { font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); }
</style>
