<script lang="ts">
  import { store } from "../lib/store.svelte";
</script>
{#if store.toast}
  <div class="toast" class:err={store.toast.level === "error"} role="alert">
    <span>{store.toast.text}</span><button class="btn ghost" onclick={() => (store.toast = null)}>×</button>
  </div>
{/if}
<style>
  .toast { position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%); z-index: 90; max-width: min(720px, 92vw); display: flex; gap: 12px; align-items: flex-start; padding: 10px 14px; border-radius: 10px; background: #1b1f2a; border: 1px solid var(--border2); box-shadow: 0 12px 40px #000a; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
  .toast.err { border-color: #f8717188; color: #ffd0d0; }
</style>
