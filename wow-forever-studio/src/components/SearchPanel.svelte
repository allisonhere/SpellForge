<script lang="ts">
  import { ipc } from "../lib/ipc";
  import { store } from "../lib/store.svelte";
  import { openFile } from "../lib/actions";

  let q = $state(""); let cs = $state(false); let timer: ReturnType<typeof setTimeout>;
  function run() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!q) { store.hits = null; return; }
      try { store.hits = { title: `“${q}”`, items: await ipc.search(q, cs, false) }; } catch (e) { store.fail(e); }
    }, 200);
  }
  const grouped = $derived.by(() => {
    const m = new Map<string, NonNullable<typeof store.hits>["items"]>();
    for (const h of store.hits?.items ?? []) (m.get(h.file) ?? m.set(h.file, []).get(h.file)!).push(h);
    return [...m];
  });
</script>

<div class="top">
  <input id="proj-q" class="text" placeholder="Search in project…" bind:value={q} oninput={run} />
  <label class="faint"><input type="checkbox" bind:checked={cs} onchange={run} /> Match case</label>
</div>
<div class="list scroll">
  {#each grouped as [file, items] (file)}
    <div class="f">{file} <span class="faint">{items.length}</span></div>
    {#each items as h (h.line + ":" + h.col)}
      <button class="r mono" onclick={() => openFile(h.file, h.line, h.col)}><span class="faint">{h.line}</span> {h.text}</button>
    {/each}
  {/each}
  {#if q && !grouped.length}<div class="empty">No results</div>{/if}
</div>

<style>
  .top { padding: 8px; display: grid; gap: 6px; border-bottom: 1px solid var(--border); }
  .list { flex: 1; padding: 4px; }
  .f { padding: 6px 8px 2px; color: var(--cyan); font-size: 12px; }
  .r { display: block; width: 100%; text-align: left; padding: 2px 8px 2px 14px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r:hover { background: var(--panel2); }
</style>
