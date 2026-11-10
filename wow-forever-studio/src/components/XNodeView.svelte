<script lang="ts">
  import type { XNode } from "../lib/types";
  import XNodeView from "./XNodeView.svelte";
  let { n, depth = 0 }: { n: XNode; depth?: number } = $props();
  const attrs = $derived(Object.entries(n.attrs));
  const hasKids = $derived(n.children.length > 0);
  let manual = $state<boolean | null>(null);
  const expanded = $derived(manual ?? depth < 2);
  const tone = $derived(n.tag === "Texture" || n.tag.endsWith("Texture") ? "cyan" : n.tag === "FontString" ? "amber" : n.tag === "Anchor" ? "violet" : "");
</script>

<div class="n" style="margin-left:{depth ? 12 : 0}px">
  <button class="h" onclick={() => (manual = !expanded)} disabled={!hasKids}>
    <span class="tw">{hasKids ? (expanded ? "▾" : "▸") : "·"}</span>
    <span class="tag {tone}">{n.tag}</span>
    {#each attrs.slice(0, 7) as [k, v] (k)}<span class="a"><i>{k}</i>={v}</span>{/each}
    {#if attrs.length > 7}<span class="faint">+{attrs.length - 7}</span>{/if}
  </button>
  {#if expanded}{#each n.children as c, i (i)}<XNodeView n={c} depth={depth + 1} />{/each}{/if}
</div>

<style>
  .n { font: 11.5px var(--mono); } .h { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; text-align: left; padding: 1px 0; width: 100%; } .h:disabled { cursor: default; }
  .tw { width: 10px; color: var(--faint); } .tag { color: var(--text); font-weight: 600; } .tag.cyan { color: var(--cyan); } .tag.amber { color: var(--amber); } .tag.violet { color: #b9a6ff; }
  .a { color: var(--dim); } .a i { font-style: normal; color: var(--faint); }
</style>
