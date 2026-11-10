<script lang="ts">
  import Modal from "./Modal.svelte";
  import { store } from "../lib/store.svelte";
  import { ipc } from "../lib/ipc";
  import { openProjectFlow } from "../lib/actions";

  let name = $state(""); let title = $state(""); let author = $state(""); let err = $state("");
  const valid = $derived(/^[A-Za-z][A-Za-z0-9_-]*$/.test(name));
  async function create() {
    err = "";
    try { await openProjectFlow(ipc.createAddon(name, title, author)); store.modal = null; } catch (e) { err = String(e); }
  }
</script>
<Modal title="New addon" onclose={() => (store.modal = null)} width={460}>
  <div class="f"><label for="n">Folder / TOC name</label><input id="n" class="text" bind:value={name} placeholder="MyAddon" /></div>
  <div class="f"><label for="t">Title</label><input id="t" class="text" bind:value={title} placeholder="My Addon" /></div>
  <div class="f"><label for="a">Author</label><input id="a" class="text" bind:value={author} /></div>
  <p class="faint small">Creates <span class="mono">{name || "MyAddon"}/{name || "MyAddon"}.toc</span> targeting Interface 16001 and a starter Lua file in a folder you pick. Existing folders are never overwritten.</p>
  {#if err}<div class="err">{err}</div>{/if}
  <div class="row end"><button class="btn ghost" onclick={() => (store.modal = null)}>Cancel</button><button class="btn primary" disabled={!valid} onclick={create}>Choose location & create…</button></div>
</Modal>
<style>
  .f { display: grid; gap: 4px; margin-bottom: 10px; } label { color: var(--dim); font-size: 12px; } .small { font-size: 11.5px; } .err { color: var(--red); } .end { justify-content: flex-end; margin-top: 8px; }
</style>
