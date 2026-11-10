<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { openFile } from "../lib/actions";
  const items = $derived(store.symbols.filter((s) => s.file === store.active).sort((a, b) => a.line - b.line));
</script>

<div class="scroll list">
  {#each items as s (s.line + s.name)}
    <button class="r" onclick={() => openFile(s.file, s.line, s.col)}>
      <span class="badge" class:cyan={s.kind === "function" || s.kind === "method"} class:violet={s.kind === "table"}>{s.kind[0]}</span>
      <span class="mono nm">{s.name}</span><span class="faint">{s.line}</span>
    </button>
  {/each}
  {#if !items.length}<div class="empty">{store.active ? "No symbols indexed for this file (index is lexical; run Validate to refresh)." : "Open a Lua file."}</div>{/if}
</div>

<style>
  .list { flex: 1; padding: 4px; }
  .r { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; padding: 3px 8px; border-radius: 5px; } .r:hover { background: var(--panel2); }
  .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
