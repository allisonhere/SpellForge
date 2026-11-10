<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { openFolder, packageNow, saveAll, dirtyCount } from "../lib/actions";
</script>

<header class="bar">
  <div class="brand"><span class="logo"></span><b>Forever</b><span class="muted">Studio</span></div>
  <div class="proj">
    {#if store.project}
      <span class="name">{store.project.addonName}</span>
      <span class="badge cyan" title="Interface versions declared by the main TOC">
        {store.project.tocs.find((t) => t.file === store.project?.mainToc)?.interface.join(", ") || "no interface"}
      </span>
    {:else}<span class="faint">No project open</span>{/if}
  </div>
  {#if store.project}
    <div class="seg"><button class:on={store.view === "code"} onclick={() => { store.view = "code"; store.persist(); }}>Code</button><button class:on={store.view === "design"} onclick={() => { store.view = "design"; store.persist(); }}>Design</button></div>
  {/if}
  <div class="grow"></div>
  {#if store.busy}<span class="muted busy">{store.busy}</span>{/if}
  <button class="btn ghost" onclick={openFolder} title="Open folder (Ctrl+O)">Open</button>
  <button class="btn ghost" onclick={() => (store.modal = "new")}>New</button>
  <span class="sep"></span>
  <button class="btn" disabled={!store.project} onclick={() => store.validate()} title="Validate project (Ctrl+Shift+V)">
    Validate
    {#if store.report}<span class="cnt">{#if store.counts.error}<i class="e">{store.counts.error}</i>{/if}{#if store.counts.warning}<i class="w">{store.counts.warning}</i>{/if}{#if !store.counts.error && !store.counts.warning}<i class="ok">✓</i>{/if}</span>{/if}
  </button>
  <button class="btn" disabled={!store.project} onclick={packageNow}>Package</button>
  <button class="btn primary" disabled={!store.project} onclick={() => (store.modal = "deploy")}>Deploy</button>
  <span class="sep"></span>
  {#if dirtyCount()}<button class="btn ghost" onclick={saveAll} title="Save all">Save all ({dirtyCount()})</button>{/if}
  <button class="btn ghost" onclick={() => { store.palettePrefix = ">"; store.modal = "palette"; }} title="Command palette (Ctrl+Shift+P)"><span class="kbd">Ctrl+Shift+P</span></button>
  <button class="btn ghost" onclick={() => (store.modal = "settings")} title="Settings (Ctrl+,)">⚙</button>
</header>

<style>
  .bar { display: flex; align-items: center; gap: 8px; height: 46px; padding: 0 12px; background: var(--panel); border-bottom: 1px solid var(--border); flex: none; }
  .brand { display: flex; align-items: center; gap: 7px; font-size: 14px; letter-spacing: .01em; }
  .logo { width: 16px; height: 16px; border-radius: 5px; background: linear-gradient(135deg, var(--violet), var(--cyan)); box-shadow: 0 0 14px #8b6cff66; }
  .proj { display: flex; align-items: center; gap: 8px; margin-left: 14px; padding-left: 14px; border-left: 1px solid var(--border); }
  .name { font-weight: 600; }
  .grow { flex: 1; }
  .seg { display: flex; margin-left: 14px; background: var(--bg); border: 1px solid var(--border2); border-radius: 8px; padding: 2px; }
  .seg button { padding: 3px 14px; border-radius: 6px; color: var(--dim); font-size: 12px; } .seg button.on { background: linear-gradient(180deg, #7a5cf5, #5f45d1); color: #fff; }
  .sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }
  .busy { margin-right: 6px; }
  .cnt { display: inline-flex; gap: 4px; margin-left: 2px; }
  .cnt i { font-style: normal; font-size: 11px; padding: 0 6px; border-radius: 99px; }
  .cnt .e { background: #f8717126; color: var(--red); } .cnt .w { background: #f5b95c22; color: var(--amber); } .cnt .ok { color: var(--green); }
</style>
