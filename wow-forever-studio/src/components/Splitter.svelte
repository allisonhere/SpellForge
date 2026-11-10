<script lang="ts">
  let { dir, onresize }: { dir: "v" | "h"; onresize: (delta: number) => void } = $props();
  let dragging = $state(false);
  function down(e: PointerEvent) {
    dragging = true;
    let last = dir === "v" ? e.clientX : e.clientY;
    const move = (m: PointerEvent) => { const cur = dir === "v" ? m.clientX : m.clientY; onresize(cur - last); last = cur; };
    const up = () => { dragging = false; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  }
</script>

<div class="split {dir}" class:on={dragging} onpointerdown={down} role="separator" aria-orientation={dir === "v" ? "vertical" : "horizontal"} tabindex="-1"></div>

<style>
  .split { flex: none; background: transparent; position: relative; z-index: 5; }
  .split.v { width: 5px; margin: 0 -2px; cursor: col-resize; }
  .split.h { height: 5px; margin: -2px 0; cursor: row-resize; }
  .split:hover, .split.on { background: linear-gradient(90deg, #8b6cff55, #22d3ee55); }
</style>
