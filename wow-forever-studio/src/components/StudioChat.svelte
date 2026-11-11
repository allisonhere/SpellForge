<script lang="ts">
  import { onMount, tick } from "svelte";
  import { studio } from "../lib/ai/studio.svelte";
  import { designer as d } from "../lib/designer.svelte";
  import { store } from "../lib/store.svelte";

  let input = $state(""); let autoAccept = $state(false); let list: HTMLDivElement;
  const chips = ["Add a Tempus-style player and target frame", "Make a party frame list with health bars, names and buff icons", "Show it as a 20-man raid under heavy damage", "Add a cast bar under the target frame"];
  onMount(async () => {
    await studio.refresh();
    const ap = store.extra.autoprompt; // testing hook, consumed once
    if (ap && studio.ready) { store.extra.autoprompt = undefined; void studio.send(ap); }
  });
  $effect(() => { void studio.bubbles.length; void studio.streamChars; tick().then(() => list?.scrollTo({ top: list.scrollHeight })); });
  $effect(() => { if (autoAccept && d.proposal) d.acceptProposal(); });
  function send() { const t = input; input = ""; void studio.send(t); }
  function key(e: KeyboardEvent) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
  const p = $derived(d.proposal);
</script>

<div class="wrap">
  <div class="top">
    {#if studio.status && !studio.ready}
      <div class="off">
        <b>AI is {studio.status.enabled ? "not set up" : "off"}.</b>
        <span class="muted"> Nothing is sent anywhere while it is off. Turn it on in Settings, enable a provider and pick a model.</span>
        <button class="btn" onclick={() => (store.modal = "settings")}>Open settings</button>
      </div>
    {:else if studio.provider}
      <div class="row"><span class="badge green">local</span><span class="mono">{studio.provider.name} · {studio.provider.model}</span><span class="grow"></span><button class="btn ghost" onclick={() => studio.clear()} title="Clear conversation">Clear</button></div>
    {/if}
  </div>

  <div class="msgs scroll" bind:this={list}>
    {#if !studio.bubbles.length}
      <div class="hello">
        <h3>Describe an interface</h3>
        <p class="muted small">The AI edits the scene as validated actions; you watch it appear live and can accept or undo each turn. Blizzard art is shown as placeholders; an addon's own textures and fonts are real.</p>
        <div class="chips">{#each chips as c (c)}<button class="chip" disabled={!studio.ready} onclick={() => void studio.send(c)}>{c}</button>{/each}</div>
      </div>
    {/if}
    {#each studio.bubbles as b, i (i)}
      <div class="b {b.role} {b.kind ?? ''}">{b.text}</div>
    {/each}
    {#if studio.busy}<div class="b note">Thinking… {studio.streamChars ? `${studio.streamChars} characters received` : ""}</div>{/if}
  </div>

  {#if p}
    <div class="prop">
      <span><b>Proposed:</b> +{p.created.length} added · ~{p.changed.length} changed · −{p.removed.length} removed <span class="faint">(dashed outline on canvas)</span></span>
      <span class="grow"></span>
      <button class="btn primary" onclick={() => d.acceptProposal()}>Keep</button>
      <button class="btn" onclick={() => d.rejectProposal()}>Undo</button>
    </div>
  {/if}

  <div class="in">
    <textarea class="text" rows="3" placeholder={studio.ready ? "Describe what you want… (Enter to send, Shift+Enter for a new line)" : "Turn AI on in Settings to start"} bind:value={input} onkeydown={key} disabled={!studio.ready || studio.busy}></textarea>
    <div class="row">
      <label class="chk faint"><input type="checkbox" bind:checked={autoAccept} /> keep changes automatically</label>
      <span class="grow"></span>
      {#if studio.busy}<button class="btn" onclick={() => studio.stop()}>Stop</button>{:else}<button class="btn primary" disabled={!studio.ready || !input.trim()} onclick={send}>Send</button>{/if}
    </div>
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; } .top { padding: 8px; border-bottom: 1px solid var(--border); font-size: 12px; } .row { display: flex; align-items: center; gap: 8px; } .grow { flex: 1; }
  .off { display: grid; gap: 6px; } .msgs { flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .hello h3 { margin: 6px 0; } .small { font-size: 11.5px; } .chips { display: grid; gap: 6px; margin-top: 8px; } .chip { text-align: left; padding: 7px 10px; border: 1px solid var(--border2); border-radius: 8px; background: var(--panel2); font-size: 12px; } .chip:hover:not(:disabled) { border-color: #8b6cff88; background: #1d1a3a; } .chip:disabled { opacity: .45; }
  .b { padding: 7px 10px; border-radius: 10px; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; max-width: 94%; }
  .b.user { align-self: flex-end; background: #2a2260; } .b.assistant { align-self: flex-start; background: var(--panel2); border: 1px solid var(--border); } .b.assistant.error { border-color: #f8717166; }
  .b.note { align-self: center; color: var(--dim); font-size: 11.5px; background: transparent; } .b.note.error { color: var(--red); } .b.note.warn { color: var(--amber); } .b.note.ok { color: var(--green); }
  .prop { display: flex; align-items: center; gap: 8px; padding: 8px; border-top: 1px solid var(--border); background: #17142e; font-size: 12px; }
  .in { padding: 8px; border-top: 1px solid var(--border); display: grid; gap: 6px; } textarea.text { resize: none; } .chk { display: flex; gap: 6px; align-items: center; font-size: 11.5px; }
</style>
