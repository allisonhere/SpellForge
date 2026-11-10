<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { commands, openFile } from "../lib/actions";
  import { searchApi } from "../lib/apiSearch";

  let q = $state(store.palettePrefix);
  let idx = $state(0);
  let input: HTMLInputElement;
  $effect(() => { input?.focus(); });

  interface Item { label: string; detail?: string; keys?: string; run: () => void }
  const items = $derived.by((): Item[] => {
    const mode = q[0];
    if (mode === ">") {
      const s = q.slice(1).trim().toLowerCase();
      return commands.filter((c) => (c.when?.() ?? true) && c.title.toLowerCase().includes(s)).map((c) => ({ label: c.title, keys: c.keys, run: () => void c.run() }));
    }
    if (mode === "@") {
      const s = q.slice(1).trim().toLowerCase();
      return store.symbols.filter((x) => x.name.toLowerCase().includes(s)).slice(0, 80).map((x) => ({ label: x.name, detail: `${x.file}:${x.line}`, run: () => void openFile(x.file, x.line, x.col) }));
    }
    if (mode === "#") {
      const s = q.slice(1).trim();
      return store.api ? searchApi(store.api, s, undefined, 60).map((h) => ({ label: h.name, detail: h.kind, run: () => { store.selectedApi = h; store.ui.showRight = true; store.ui.rightTab = "docs"; } })) : [];
    }
    const s = q.trim().toLowerCase();
    return store.files.filter((f) => !f.isDir && f.path.toLowerCase().includes(s)).slice(0, 80).map((f) => ({ label: f.path.split("/").pop() ?? f.path, detail: f.path, run: () => void openFile(f.path) }));
  });
  $effect(() => { void q; idx = 0; });
  function key(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { idx = Math.min(idx + 1, items.length - 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { idx = Math.max(idx - 1, 0); e.preventDefault(); }
    else if (e.key === "Enter") { const it = items[idx]; store.modal = null; it?.run(); }
  }
</script>
<svelte:window onkeydown={(e) => e.key === "Escape" && (store.modal = null)} />
<div class="ov" onpointerdown={(e) => e.target === e.currentTarget && (store.modal = null)} role="presentation">
  <div class="p">
    <input bind:this={input} class="in" bind:value={q} onkeydown={key} placeholder="File name · > commands · @ symbols · # API" />
    <div class="l scroll">
      {#each items as it, i (it.label + (it.detail ?? "") + i)}
        <button class="it" class:on={i === idx} onclick={() => { store.modal = null; it.run(); }} onmousemove={() => (idx = i)}>
          <span>{it.label}</span><span class="faint d">{it.detail ?? ""}</span>{#if it.keys}<span class="kbd">{it.keys}</span>{/if}
        </button>
      {/each}
      {#if !items.length}<div class="empty">No matches</div>{/if}
    </div>
  </div>
</div>
<style>
  .ov { position: fixed; inset: 0; background: #05060a88; z-index: 60; display: grid; place-items: start center; padding-top: 12vh; }
  .p { width: 620px; max-width: 94vw; background: var(--panel); border: 1px solid var(--border2); border-radius: 12px; box-shadow: 0 24px 80px #000b, 0 0 0 1px #22d3ee1c; overflow: hidden; }
  .in { width: 100%; background: transparent; border: 0; border-bottom: 1px solid var(--border); padding: 14px 16px; font-size: 15px; outline: none; }
  .l { max-height: 50vh; padding: 6px; }
  .it { display: flex; gap: 10px; align-items: center; width: 100%; text-align: left; padding: 7px 10px; border-radius: 7px; }
  .it.on { background: #2a2260; } .d { flex: 1; font-size: 11.5px; font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
</style>
