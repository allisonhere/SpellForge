<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { openFile } from "../lib/actions";

  let sel = $state<string | null>(null);
  const toc = $derived(store.project?.tocs.find((t) => t.file === (sel ?? store.project?.mainToc)) ?? store.project?.tocs[0]);
  const problems = (line: number) => store.allDiagnostics.filter((d) => d.file === toc?.file && d.line === line && (d.severity === "error" || d.severity === "warning"));
</script>

{#if !toc}
  <div class="empty">No .toc file found in this folder.</div>
{:else}
  <div class="scroll body">
    {#if (store.project?.tocs.length ?? 0) > 1}
      <div class="sec"><select class="text" bind:value={sel}>{#each store.project!.tocs as t (t.file)}<option value={t.file}>{t.file}</option>{/each}</select></div>
    {/if}
    <div class="sec">
      <h4>Metadata</h4>
      <div class="kv"><span>Title</span><b>{toc.title ?? "—"}</b></div>
      <div class="kv"><span>Version</span><b>{toc.version ?? "—"}</b></div>
      <div class="kv"><span>Author</span><b>{toc.author ?? "—"}</b></div>
      <div class="kv"><span>Interface</span><b class="row">{#each toc.interface as i (i)}<span class="badge" class:cyan={i === 16001}>{i}</span>{/each}{#if !toc.interface.length}—{/if}</b></div>
      {#if toc.notes}<p class="muted notes">{toc.notes}</p>{/if}
    </div>
    <div class="sec">
      <h4>Saved variables</h4>
      {#each [...toc.savedVariables, ...toc.savedVariablesPerCharacter] as v (v)}<span class="badge violet mono">{v}</span>{/each}
      {#if !toc.savedVariables.length && !toc.savedVariablesPerCharacter.length}<span class="faint">none</span>{/if}
    </div>
    <div class="sec">
      <h4>Dependencies</h4>
      {#each toc.dependencies as d (d)}<div class="row"><span class="badge red">required</span> <span class="mono">{d}</span></div>{/each}
      {#each toc.optionalDeps as d (d)}<div class="row"><span class="badge">optional</span> <span class="mono">{d}</span></div>{/each}
      {#if !toc.dependencies.length && !toc.optionalDeps.length}<span class="faint">none</span>{/if}
    </div>
    <div class="sec">
      <h4>Load order · {toc.entries.length} files</h4>
      {#each toc.entries as e, i (e.line)}
        {@const ps = problems(e.line)}
        <button class="ent" onclick={() => openFile(e.path)} title={ps.map((p) => p.message).join("\n") || e.raw}>
          <span class="faint idx">{i + 1}</span><span class="mono nm" class:bad={ps.length}>{e.path}</span>
          {#if e.condition}<span class="badge amber" title={e.condition}>cond</span>{/if}
          {#if ps.length}<span class="badge red">!</span>{/if}
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .body { flex: 1; }
  .kv { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; } .kv span { color: var(--faint); } .kv b { font-weight: 500; text-align: right; overflow: hidden; text-overflow: ellipsis; }
  .notes { margin: 8px 0 0; font-size: 12px; }
  .ent { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; padding: 2px 4px; border-radius: 4px; }
  .ent:hover { background: var(--panel2); }
  .idx { width: 22px; text-align: right; font-size: 11px; flex: none; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-size: 11.5px; } .nm.bad { color: var(--red); }
  .badge.mono { margin-right: 4px; }
</style>
