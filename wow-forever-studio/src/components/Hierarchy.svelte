<script lang="ts">
  import { designer as d } from "../lib/designer.svelte";
  import { isContainer, type SceneNode } from "../lib/scene";

  let over = $state<string | null>(null);
  let dragId: string | null = null;
  const rows = $derived.by(() => {
    const out: { n: SceneNode; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      // front-most last in creation order -> show top of list = front-most
      for (const n of d.childrenOf(parent).slice().reverse()) { out.push({ n, depth }); walk(n.id, depth + 1); }
    };
    walk(null, 0);
    return out;
  });
  const glyph: Record<string, string> = { frame: "▢", button: "⏍", texture: "◩", fontstring: "T", statusbar: "▰" };
</script>

<div class="list scroll" role="tree">
  {#each rows as { n, depth } (n.id)}
    <div class="r" class:act={d.selection === n.id} class:over={over === n.id} style="padding-left:{8 + depth * 14}px" role="treeitem" tabindex="-1" aria-selected={d.selection === n.id}
      draggable="true" ondragstart={() => (dragId = n.id)} ondragover={(e) => { if (isContainer(n.kind)) { e.preventDefault(); over = n.id; } }} ondragleave={() => (over = null)}
      ondrop={(e) => { e.preventDefault(); over = null; if (dragId) d.reparent(dragId, n.id); dragId = null; }}>
      <button class="main" onclick={() => (d.selection = n.id)}>
        <span class="g" class:c={isContainer(n.kind)}>{glyph[n.kind]}</span><span class="nm" class:h={n.hidden}>{n.name}</span>
      </button>
      {#if d.solved.errors.has(n.id)}<span class="badge amber" title={d.solved.errors.get(n.id)}>!</span>{/if}
      <button class="eye" title={n.hidden ? "Show" : "Hide"} onclick={() => { d.selection = n.id; d.edit(() => { n.hidden = !n.hidden; }, true); }}>{n.hidden ? "◌" : "◉"}</button>
    </div>
  {/each}
  <div class="root-drop" class:over={over === "__root"} role="presentation" ondragover={(e) => { e.preventDefault(); over = "__root"; }} ondragleave={() => (over = null)}
    ondrop={(e) => { e.preventDefault(); over = null; if (dragId) d.reparent(dragId, null); dragId = null; }}>drop here for top level</div>
  {#if !rows.length}<div class="empty">Empty scene. Add a Frame or a template above.</div>{/if}
</div>

<style>
  .list { flex: 1; padding: 4px; }
  .r { display: flex; align-items: center; height: 25px; border-radius: 5px; gap: 4px; padding-right: 4px; } .r:hover { background: var(--panel2); } .r.act { background: #2a2260; } .r.over { outline: 1px solid var(--cyan); }
  .main { display: flex; gap: 7px; align-items: center; flex: 1; text-align: left; min-width: 0; height: 100%; }
  .g { width: 14px; text-align: center; color: var(--faint); } .g.c { color: var(--cyan); } .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .nm.h { color: var(--faint); text-decoration: line-through; }
  .eye { color: var(--faint); width: 20px; } .eye:hover { color: var(--text); }
  .root-drop { margin: 8px 4px; padding: 6px; border: 1px dashed var(--border2); border-radius: 6px; text-align: center; color: var(--faint); font-size: 11px; } .root-drop.over { border-color: var(--cyan); color: var(--cyan); }
</style>
