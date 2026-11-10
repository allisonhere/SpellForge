<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { openFolder, openRecent } from "../lib/actions";
</script>

<div class="wrap">
  <div class="card">
    <div class="logo"></div>
    <h1>WoW Forever Studio</h1>
    <p class="muted">Offline IDE for World of Warcraft: Forever addons. Open an addon folder to edit Lua, inspect the TOC, search the bundled API, validate and package. Nothing here needs the internet.</p>
    <div class="row cta">
      <button class="btn primary" onclick={openFolder}>Open Addon Folder…</button>
      <button class="btn" onclick={() => (store.modal = "new")}>New Addon…</button>
    </div>
    {#if store.recent.length}
      <h4>Recent</h4>
      <ul>
        {#each store.recent as r (r)}
          <li><button class="rec" onclick={() => openRecent(r)}><span>{r.split(/[\\/]/).pop()}</span><span class="faint mono">{r}</span></button></li>
        {/each}
      </ul>
    {/if}
    <p class="faint small">API snapshot: build {store.api?.meta.build ?? "…"} ({store.apiOrigin}) · {store.api?.meta.counts.functions?.toLocaleString() ?? "…"} functions · {store.api?.meta.counts.events?.toLocaleString() ?? "…"} events</p>
  </div>
</div>

<style>
  .wrap { height: 100%; display: grid; place-items: center; background: radial-gradient(900px 500px at 50% 30%, #1a1633 0%, transparent 70%), var(--bg); }
  .card { width: min(560px, 92%); }
  .logo { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, var(--violet), var(--cyan)); box-shadow: 0 0 40px #8b6cff55; margin-bottom: 18px; }
  h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: -.01em; }
  .cta { margin: 18px 0 26px; }
  h4 { margin: 0 0 8px; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }
  ul { list-style: none; margin: 0 0 20px; padding: 0; display: grid; gap: 2px; }
  .rec { width: 100%; text-align: left; padding: 7px 10px; border-radius: 7px; display: flex; flex-direction: column; }
  .rec:hover { background: var(--panel2); }
  .small { font-size: 11.5px; }
</style>
