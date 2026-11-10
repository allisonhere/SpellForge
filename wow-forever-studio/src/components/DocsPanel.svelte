<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { provenance, notesFor, namespaceFunctions, type ApiHit } from "../lib/apiSearch";
  import { monaco, docs } from "../lib/monacoSetup";

  const h = $derived(store.selectedApi);
  const notes = $derived(h ? notesFor(store.notes, h.name) : []);
  const members = $derived(h?.kind === "namespace" && store.api ? namespaceFunctions(store.api, h.name) : []);
  const tone: Record<string, string> = { measured: "green", reported: "amber", inferred: "violet" };
  function insert(text: string) {
    const ed = monaco.editor.getEditors()[0];
    if (!ed || !store.active || !docs.has(store.active)) return;
    ed.executeEdits("api-insert", [{ range: ed.getSelection()!, text, forceMoveMarkers: true }]);
    ed.focus();
  }
  function example(x: ApiHit): string {
    if (x.kind === "event") return `frame:RegisterEvent("${x.name}")`;
    if (x.kind === "function" && x.fn) { const args = (x.fn.args ?? []).map((a) => a.n).join(", "); return `${x.fn.name}(${args})`; }
    return x.name;
  }
</script>

{#if !h}
  <div class="empty">Select an item in the API browser (Ctrl+Shift+A).<br /><span class="small">Hover over API names in the editor for the same details.</span></div>
{:else}
  <div class="scroll body">
    <div class="sec">
      <div class="row"><span class="badge cyan">{h.kind}</span><b class="mono title">{h.name}</b></div>
      {#if h.fn}
        <pre class="code">{h.fn.sig ?? h.fn.name + "(…)   -- signature not documented"}</pre>
        {#if h.fn.doc}<p>{h.fn.doc}</p>{/if}
        {#if h.fn.system}<div class="faint small">System: {h.fn.system}</div>{/if}
        <div class="faint small">Source: {provenance(h.fn.src)} · build {store.api?.meta.build}</div>
        {#if !(h.fn.src & 1)}<div class="note amber">No documented signature. This is a documentation gap, not a statement that the function is unsupported or restricted.</div>{/if}
      {:else if h.ev}
        <pre class="code">{h.ev.name}({h.ev.payload.map((p) => p.n + ": " + p.t).join(", ")})</pre>
        <div class="faint small">System: {h.ev.system} · build {store.api?.meta.build}</div>
      {:else if h.ty}
        <div class="faint small">{h.ty.kind} · {h.ty.system}</div>
      {/if}
    </div>
    {#if h.fn && (h.fn.args?.length || h.fn.rets?.length)}
      <div class="sec">
        <h4>Parameters</h4>
        {#each h.fn.args ?? [] as a (a.n)}<div class="p"><span class="mono">{a.n}</span><span class="faint mono">{a.t}{a.i ? `<${a.i}>` : ""}{a.o ? "?" : ""}</span></div>{/each}
        {#if !h.fn.args?.length}<span class="faint">none</span>{/if}
        <h4 class="gap">Returns</h4>
        {#each h.fn.rets ?? [] as a, i (i)}<div class="p"><span class="mono">{a.n}</span><span class="faint mono">{a.t}{a.i ? `<${a.i}>` : ""}{a.o ? "?" : ""}</span></div>{/each}
        {#if !h.fn.rets?.length}<span class="faint">nothing</span>{/if}
      </div>
    {/if}
    {#if h.ev?.payload.length}
      <div class="sec"><h4>Payload</h4>{#each h.ev.payload as a (a.n)}<div class="p"><span class="mono">{a.n}</span><span class="faint mono">{a.t}{a.o ? "?" : ""}</span></div>{/each}</div>
    {/if}
    {#if h.ty?.values}<div class="sec"><h4>Values</h4>{#each h.ty.values as [n, v] (n)}<div class="p"><span class="mono">{n}</span><span class="faint mono">{v}</span></div>{/each}</div>{/if}
    {#if h.ty?.fields}<div class="sec"><h4>Fields</h4>{#each h.ty.fields as a (a.n)}<div class="p"><span class="mono">{a.n}</span><span class="faint mono">{a.t}{a.o ? "?" : ""}</span></div>{/each}</div>{/if}
    {#if members.length}<div class="sec"><h4>{members.length} functions</h4>{#each members as m (m.name)}<button class="mem mono" onclick={() => (store.selectedApi = { kind: "function", name: m.name, summary: m.sig ?? "", fn: m, score: 0 })}>{m.name.split(".")[1]}</button>{/each}</div>{/if}
    {#if notes.length}
      <div class="sec">
        <h4>Compatibility notes</h4>
        {#each notes as n (n.id)}
          <div class="note"><span class="badge {tone[n.level] ?? ''}">{n.level}</span> <span class="badge">{n.category}</span><p>{n.text}</p><div class="faint small">Source: {n.source}</div></div>
        {/each}
      </div>
    {/if}
    <div class="sec">
      <h4>Example</h4>
      <pre class="code">{example(h)}</pre>
      <button class="btn" onclick={() => insert(example(h))} disabled={!store.active}>Insert at cursor</button>
      <p class="faint small">Presence in the snapshot does not mean callable from every addon: protected actions, secret values and combat lockdown still apply.</p>
    </div>
  </div>
{/if}

<style>
  .body { flex: 1; } .title { word-break: break-all; }
  .code { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font: 12px var(--mono); white-space: pre-wrap; word-break: break-word; margin: 8px 0; }
  .p { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; } .gap { margin-top: 12px !important; }
  .small { font-size: 11.5px; } p { margin: 6px 0; color: var(--text); }
  .note { border-left: 2px solid var(--border2); padding: 4px 0 4px 10px; margin: 6px 0; } .note.amber { border-color: var(--amber); color: var(--amber); font-size: 12px; }
  .mem { display: inline-block; margin: 2px 4px 2px 0; padding: 1px 7px; border-radius: 5px; background: var(--panel2); font-size: 11.5px; } .mem:hover { background: var(--raised); color: var(--cyan); }
</style>
