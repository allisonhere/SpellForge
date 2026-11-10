<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { openFile } from "../lib/actions";
  import type { Diagnostic, Severity } from "../lib/types";
  import { designer } from "../lib/designer.svelte";
  let evFilter = $state("");
  const evs = $derived((designer.simVersion, designer.sim.state.log.filter((e) => !evFilter || (e.name + " " + e.args).toLowerCase().includes(evFilter.toLowerCase())).slice(-250).reverse()));

  let filter = $state<Record<Severity, boolean>>({ error: true, warning: true, info: true, hint: false });
  let onlyGame = $state(false);
  const rows = $derived(store.allDiagnostics.filter((d) => filter[d.severity] && (!onlyGame || d.evidence === "needs-game-test")));
  const sym: Record<Severity, string> = { error: "✖", warning: "▲", info: "●", hint: "○" };
  const conf: Record<string, string> = { certain: "certain", sourced: "sourced", "snapshot-absence": "snapshot absence", heuristic: "heuristic" };
  const tabs = $derived<[string, string][]>([["problems", `Problems ${store.allDiagnostics.filter((d) => d.severity === "error" || d.severity === "warning").length}`], ["output", "Output"], ["results", "Results"], ["sim", "Simulation"]]);
  function open(d: Diagnostic) { if (d.file) void openFile(d.file, d.line || 1, d.col || 1); }
  const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
</script>

<div class="panel-h">
  {#each tabs as [id, label] (id)}
    <button class="tabbtn" class:on={store.ui.bottomTab === id} onclick={() => { store.ui.bottomTab = id; store.persist(); }}>{label}</button>
  {/each}
  <span class="grow"></span>
  {#if store.ui.bottomTab === "problems"}
    {#each Object.keys(filter) as k (k)}<button class="chip" class:on={filter[k as Severity]} onclick={() => (filter[k as Severity] = !filter[k as Severity])}>{k}</button>{/each}
    <button class="chip" class:on={onlyGame} onclick={() => (onlyGame = !onlyGame)} title="Show only findings that need the real game client">needs game test</button>
  {/if}
  <button class="btn ghost" onclick={() => { store.ui.showBottom = false; store.persist(); }}>×</button>
</div>

<div class="scroll body">
  {#if store.ui.bottomTab === "problems"}
    {#if !store.report}<div class="empty">Run <b>Validate</b> to analyse the project.</div>{:else}
      {#if store.report.scope}<div class="scope faint">{store.report.scope}</div>{/if}
      {#each rows as d, i (i + d.code + d.line + (d.file ?? ""))}
        <button class="d" onclick={() => open(d)}>
          <span class="s {d.severity}">{sym[d.severity]}</span>
          <span class="m">{d.message}</span>
          <span class="meta">
            <span class="badge" title="How certain this finding is">{conf[d.confidence]}</span>
            {#if d.evidence === "needs-game-test"}<span class="badge amber" title="Cannot be confirmed by static analysis or simulation">needs game test</span>{:else}<span class="badge green">static</span>{/if}
            <span class="faint mono">{d.file ?? ""}{d.line ? `:${d.line}` : ""}</span>
            <span class="faint mono">{d.code}</span>
          </span>
        </button>
      {/each}
      {#if !rows.length}<div class="empty">No findings at the selected levels.</div>{/if}
    {/if}
  {:else if store.ui.bottomTab === "output"}
    <div class="out mono">{#each store.log as l (l.t + l.text)}<div class={l.level}><span class="faint">{fmt(l.t)}</span> {l.text}</div>{/each}</div>
  {:else if store.ui.bottomTab === "sim"}
    <div class="scope faint row"><span>Simulated events · {designer.scenario.name} · t={(designer.simVersion, (designer.sim.state.t / 1000).toFixed(1))}s · deterministic (seed {designer.scenario.seed})</span><input class="text flt" placeholder="filter, e.g. UNIT_AURA" bind:value={evFilter} /></div>
    <div class="out mono">{#each evs as e, i (i + e.t + e.name + e.args)}<div><span class="faint">{(e.t / 1000).toFixed(1).padStart(6)}s</span> <span class="evn">{e.name}</span> <span class="faint">{e.args}</span></div>{/each}</div>
  {:else}
    {#if store.hits}
      <div class="scope faint">{store.hits.title} · {store.hits.items.length}{store.hits.items.length >= 500 ? "+ (truncated)" : ""} results</div>
      {#each store.hits.items as h (h.file + h.line + h.col)}
        <button class="d" onclick={() => openFile(h.file, h.line, h.col)}><span class="m mono">{h.text}</span><span class="meta faint mono">{h.file}:{h.line}</span></button>
      {/each}
    {:else}<div class="empty">Search results and references (Shift+F12) appear here.</div>{/if}
  {/if}
</div>

<style>
  .grow { flex: 1; }
  .chip { font-size: 11px; padding: 1px 8px; border-radius: 99px; border: 1px solid var(--border2); color: var(--faint); margin-left: 4px; } .chip.on { color: var(--text); border-color: #8b6cff88; background: #8b6cff1f; }
  .body { flex: 1; background: var(--bg); }
  .scope { padding: 6px 12px; font-size: 11.5px; border-bottom: 1px solid var(--border); }
  .d { display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; width: 100%; text-align: left; padding: 4px 12px; border-bottom: 1px solid #14161d; }
  .d:hover { background: var(--panel2); }
  .s { width: 14px; flex: none; font-size: 11px; } .s.error { color: var(--red); } .s.warning { color: var(--amber); } .s.info { color: var(--blue); } .s.hint { color: var(--faint); }
  .m { flex: 1 1 0; min-width: 260px; }
  .meta { display: flex; gap: 8px; align-items: center; flex: 1 0 100%; padding-left: 24px; font-size: 11px; flex-wrap: wrap; }
  .flt { width: 200px; padding: 2px 8px; } .evn { color: var(--cyan); }
  .out { padding: 8px 12px; } .out .ok { color: var(--green); } .out .warn { color: var(--amber); } .out .error { color: var(--red); }
</style>
