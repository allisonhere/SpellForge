<script lang="ts">
  import type { Snippet } from "svelte";
  let { title, onclose, width = 560, children }: { title: string; onclose: () => void; width?: number; children: Snippet } = $props();
</script>
<svelte:window onkeydown={(e) => e.key === "Escape" && onclose()} />
<div class="ov" onpointerdown={(e) => e.target === e.currentTarget && onclose()} role="presentation">
  <div class="m" style="width:{width}px" role="dialog" aria-label={title}>
    <div class="h"><b>{title}</b><button class="btn ghost" onclick={onclose}>×</button></div>
    <div class="b scroll">{@render children()}</div>
  </div>
</div>
<style>
  .ov { position: fixed; inset: 0; background: #05060a99; backdrop-filter: blur(2px); display: grid; place-items: start center; padding-top: 9vh; z-index: 50; }
  .m { max-width: 94vw; max-height: 80vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--border2); border-radius: 12px; box-shadow: 0 24px 80px #000a, 0 0 0 1px #8b6cff1a; }
  .h { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .b { padding: 14px; }
</style>
