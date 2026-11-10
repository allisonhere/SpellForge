<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { openFile } from "../lib/actions";

  interface Node { name: string; path: string; isDir: boolean; children: Node[]; link: boolean }
  let collapsed = $state<Record<string, boolean>>({});

  const tree = $derived.by(() => {
    const root: Node = { name: "", path: "", isDir: true, children: [], link: false };
    const dirs = new Map<string, Node>([["", root]]);
    for (const f of store.files) {
      const parts = f.path.split("/");
      const name = parts.pop() ?? f.path;
      const parent = dirs.get(parts.join("/")) ?? root;
      const n: Node = { name, path: f.path, isDir: f.isDir, children: [], link: f.isSymlink };
      parent.children.push(n);
      if (f.isDir) dirs.set(f.path, n);
    }
    const sort = (n: Node) => { n.children.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)); n.children.forEach(sort); };
    sort(root);
    return root;
  });
  const loaded = $derived(new Set((store.project?.tocs ?? []).flatMap((t) => t.entries.map((e) => e.path.toLowerCase()))));

  function flat(n: Node, depth: number, out: { n: Node; depth: number }[]) {
    for (const c of n.children) {
      out.push({ n: c, depth });
      if (c.isDir && !collapsed[c.path]) flat(c, depth + 1, out);
    }
    return out;
  }
  const rows = $derived(flat(tree, 0, []));
  const icon = (n: Node) => n.isDir ? (collapsed[n.path] ? "▸" : "▾") : n.name.endsWith(".lua") ? "ʟ" : n.name.endsWith(".xml") ? "‹›" : n.name.endsWith(".toc") ? "≡" : "·";
  const diagCount = (path: string) => store.allDiagnostics.filter((d) => d.file === path && (d.severity === "error" || d.severity === "warning"));
</script>

<div class="list scroll">
  {#each rows as { n, depth } (n.path)}
    {@const ds = n.isDir ? [] : diagCount(n.path)}
    <button class="r" class:act={store.active === n.path} style="padding-left:{8 + depth * 14}px"
      onclick={() => (n.isDir ? (collapsed[n.path] = !collapsed[n.path]) : openFile(n.path))} title={n.path}>
      <span class="ic" class:lua={n.name.endsWith(".lua")} class:xml={n.name.endsWith(".xml")} class:toc={n.name.endsWith(".toc")}>{icon(n)}</span>
      <span class="nm" class:dim={!n.isDir && n.name.match(/\.(lua|xml)$/) && !loaded.has(n.path.toLowerCase())}>{n.name}</span>
      {#if n.link}<span class="badge amber">link</span>{/if}
      {#if ds.length}<span class="dot" class:e={ds.some((d) => d.severity === "error")}>{ds.length}</span>{/if}
    </button>
  {/each}
  {#if !rows.length}<div class="empty">No files</div>{/if}
</div>
<div class="foot faint">Dimmed = not loaded by the TOC</div>

<style>
  .list { flex: 1; padding: 4px 4px; }
  .r { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; height: 24px; border-radius: 5px; padding-right: 8px; color: var(--text); }
  .r:hover { background: var(--panel2); }
  .r.act { background: #2a2260; }
  .ic { width: 14px; text-align: center; color: var(--faint); font-size: 11px; font-family: var(--mono); flex: none; }
  .ic.lua { color: var(--cyan); } .ic.xml { color: var(--amber); } .ic.toc { color: var(--violet); }
  .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nm.dim { color: var(--faint); }
  .dot { font-size: 10.5px; padding: 0 6px; border-radius: 99px; background: #f5b95c22; color: var(--amber); }
  .dot.e { background: #f8717126; color: var(--red); }
  .foot { padding: 6px 12px; font-size: 11px; border-top: 1px solid var(--border); }
</style>
