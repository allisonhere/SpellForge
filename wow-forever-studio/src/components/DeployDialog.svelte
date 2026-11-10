<script lang="ts">
  import Modal from "./Modal.svelte";
  import { ipc } from "../lib/ipc";
  import { store } from "../lib/store.svelte";
  import type { DeployPlan } from "../lib/types";

  let instId = $state(store.installations[0]?.id ?? "");
  let plan = $state<DeployPlan | null>(null);
  let confirm = $state(false);
  let err = $state("");
  let done = $state("");

  async function refresh() {
    plan = null; err = ""; done = ""; confirm = false;
    if (!instId) return;
    try { plan = await ipc.deployPlan(instId); } catch (e) { err = String(e); }
  }
  $effect(() => { void instId; refresh(); });
  async function apply() {
    try {
      const r = await ipc.deployApply(instId, confirm);
      done = `Deployed ${r.files} files to ${r.destination}${r.backup ? `\nPrevious install backed up to ${r.backup}` : ""}`;
      store.say("ok", done.replace("\n", " · "));
      plan = await ipc.deployPlan(instId);
    } catch (e) { err = String(e); }
  }
</script>

<Modal title="Deploy to WoW installation" onclose={() => (store.modal = null)}>
  {#if !store.installations.length}
    <p>No WoW installation is configured. Add one first — deploys only go to folders you approve.</p>
    <button class="btn primary" onclick={() => (store.modal = "settings")}>Open settings</button>
  {:else}
    <label class="muted">Target
      <select class="text" bind:value={instId}>{#each store.installations as i (i.id)}<option value={i.id}>{i.name} — {i.addonsDir}</option>{/each}</select>
    </label>
    {#if plan}
      <div class="box">
        <div class="mono small">{plan.destination}</div>
        <div class="muted">{plan.files} files · {(plan.bytes / 1024).toFixed(0)} KB · source project is not modified</div>
        {#if plan.isSymlink}<div class="badge red">destination is a symbolic link — deploy refused</div>
        {:else if plan.exists}
          <div class="warn">An addon with this name is already installed. It will be copied to a backup folder, then replaced.</div>
          <label class="row"><input type="checkbox" bind:checked={confirm} /> I understand — back up and overwrite the existing install</label>
        {:else}<div class="badge green">No existing install — safe new copy</div>{/if}
      </div>
    {/if}
    {#if err}<div class="err">{err}</div>{/if}
    {#if done}<pre class="ok">{done}</pre>{/if}
    <div class="row end">
      <button class="btn ghost" onclick={() => (store.modal = null)}>Close</button>
      <button class="btn primary" disabled={!plan || plan.isSymlink || (plan.exists && !confirm)} onclick={apply}>{plan?.exists ? "Back up & deploy" : "Deploy"}</button>
    </div>
  {/if}
</Modal>

<style>
  .box { margin: 12px 0; padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; display: grid; gap: 8px; }
  .small { font-size: 11.5px; word-break: break-all; } .warn { color: var(--amber); } .err { color: var(--red); margin: 8px 0; } .ok { color: var(--green); white-space: pre-wrap; font: 12px var(--mono); }
  .end { justify-content: flex-end; margin-top: 12px; }
</style>
