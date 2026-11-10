<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { openNested, openFolder } from "../lib/actions";
</script>
<div class="box">
  <h3>No .toc file in this folder</h3>
  <p class="muted">WoW only loads a folder that has a <span class="mono">.toc</span> at its top level, so this is not an addon root yet.</p>
  {#if store.project?.nestedAddons.length}
    <p>Addons found inside it. Pick one to open:</p>
    <div class="list">{#each store.project.nestedAddons as n (n)}<button class="btn" onclick={() => openNested(n)}>{n}</button>{/each}</div>
  {:else}
    <p class="muted">No addon folders (a subfolder containing a .toc) were found within three levels either. Choose the folder that contains your <span class="mono">YourAddon.toc</span>.</p>
  {/if}
  <button class="btn primary" onclick={openFolder}>Choose another folder…</button>
</div>
<style>
  .box { margin: auto; max-width: 560px; padding: 24px; } h3 { margin: 0 0 8px; } .list { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 16px; }
</style>
