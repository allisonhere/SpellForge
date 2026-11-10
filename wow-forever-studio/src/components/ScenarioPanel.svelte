<script lang="ts">
  import { designer as d } from "../lib/designer.svelte";
  import { NOT_SIMULATED, SIMULATED_EVENTS, SUPPORT } from "../lib/sim/bind";
  import type { Scenario } from "../lib/sim/types";

  type Field = { k: keyof Scenario; label: string; kind: "num" | "bool" | "text" | "select"; step?: number; opts?: string[]; help?: string };
  const groups: { title: string; fields: Field[] }[] = [
    { title: "Random & group", fields: [
      { k: "seed", label: "Seed", kind: "num", help: "Same seed ⇒ identical run" },
      { k: "group", label: "Group", kind: "select", opts: ["solo", "party", "raid"] },
      { k: "groupSize", label: "Group size", kind: "num" },
      { k: "startInCombatAtMs", label: "Enter combat at (ms, -1 never)", kind: "num", step: 100 } ] },
    { title: "Player", fields: [
      { k: "playerHealthPct", label: "Health %", kind: "num" }, { k: "playerMaxHealth", label: "Max health", kind: "num", step: 1000 },
      { k: "playerPowerType", label: "Power type", kind: "select", opts: ["MANA", "RAGE", "ENERGY"] }, { k: "playerPowerPct", label: "Power %", kind: "num" },
      { k: "playerCastEveryMs", label: "Cast every (ms, 0 off)", kind: "num", step: 100 }, { k: "playerCastTimeMs", label: "Cast time (ms)", kind: "num", step: 100 }, { k: "playerCastSpell", label: "Cast spell", kind: "text" } ] },
    { title: "Target", fields: [
      { k: "targetName", label: "Name", kind: "text" }, { k: "targetMaxHealth", label: "Max health", kind: "num", step: 10000 }, { k: "targetDpsPctPerSec", label: "Damage taken (%/s)", kind: "num", step: 0.1 },
      { k: "targetCastEveryMs", label: "Cast every (ms, 0 off)", kind: "num", step: 100 }, { k: "targetCastTimeMs", label: "Cast time (ms)", kind: "num", step: 100 }, { k: "targetCastSpell", label: "Cast spell", kind: "text" },
      { k: "targetCastInterruptible", label: "Interruptible (odd casts)", kind: "bool" }, { k: "interruptTargetCasts", label: "Player kicks casts", kind: "bool" } ] },
    { title: "Damage & healing", fields: [
      { k: "damageEveryMs", label: "Damage every (ms, 0 off)", kind: "num", step: 50 }, { k: "damagePctMin", label: "Damage min %", kind: "num", step: 0.5 }, { k: "damagePctMax", label: "Damage max %", kind: "num", step: 0.5 },
      { k: "damagePlayerBias", label: "Chance it hits player (0–1)", kind: "num", step: 0.05 },
      { k: "healEveryMs", label: "Heal every (ms, 0 off)", kind: "num", step: 50 }, { k: "healPctMin", label: "Heal min %", kind: "num", step: 0.5 }, { k: "healPctMax", label: "Heal max %", kind: "num", step: 0.5 } ] },
    { title: "Auras", fields: [
      { k: "auraEveryMs", label: "Apply every (ms, 0 off)", kind: "num", step: 50 }, { k: "buffDurationMs", label: "Buff duration (ms)", kind: "num", step: 500 }, { k: "debuffDurationMs", label: "Debuff duration (ms)", kind: "num", step: 500 } ] },
  ];
  let newName = $state("");
  const sc = $derived(d.scenario);
  const val = (k: keyof Scenario) => sc[k] as string | number | boolean;
  const clock = $derived((d.simVersion, (d.sim.state.t / 1000).toFixed(1)));
</script>

<div class="scroll body">
  <div class="sec">
    <h4>Scenario</h4>
    <select class="text" bind:value={d.scenarioId}>{#each d.scenarios as s (s.id)}<option value={s.id}>{s.name}</option>{/each}</select>
    <p class="muted small">{sc.description}</p>
    <div class="row wrap">
      <button class="btn primary" onclick={() => (d.playing ? d.pause() : d.play())}>{d.playing ? "⏸ Pause" : "▶ Play"}</button>
      <button class="btn" onclick={() => d.stepOnce()} title="Advance one 100 ms tick">Step</button>
      <button class="btn" onclick={() => d.resetSim()}>Reset</button>
      <select class="text spd" bind:value={d.speed}>{#each [0.25, 0.5, 1, 2, 4, 8] as v (v)}<option value={v}>{v}×</option>{/each}</select>
    </div>
    <div class="clock mono">t = {clock}s · {d.sim.state.inCombat ? "IN COMBAT" : "out of combat"} · {Object.keys(d.sim.state.units).length} units</div>
  </div>
  <div class="sec">
    <h4>Parameters {#if d.isOverridden}<span class="badge violet">edited</span>{/if}</h4>
    {#each groups as g (g.title)}
      <details>
        <summary>{g.title}</summary>
        {#each g.fields as f (f.k)}
          <label title={f.help ?? ""}>{f.label}
            {#if f.kind === "num"}<input class="text" type="number" step={f.step ?? 1} value={val(f.k) as number} onchange={(e) => { d.setScenarioParam(f.k, parseFloat(e.currentTarget.value) as never); d.resetSim(); }} />
            {:else if f.kind === "bool"}<input type="checkbox" checked={val(f.k) as boolean} onchange={(e) => { d.setScenarioParam(f.k, e.currentTarget.checked as never); d.resetSim(); }} />
            {:else if f.kind === "select"}<select class="text" value={val(f.k) as string} onchange={(e) => { d.setScenarioParam(f.k, e.currentTarget.value as never); d.resetSim(); }}>{#each f.opts ?? [] as o (o)}<option>{o}</option>{/each}</select>
            {:else}<input class="text" value={val(f.k) as string} onchange={(e) => { d.setScenarioParam(f.k, e.currentTarget.value as never); d.resetSim(); }} />{/if}
          </label>
        {/each}
      </details>
    {/each}
    <div class="row wrap"><button class="btn ghost" disabled={!d.isOverridden} onclick={() => { d.resetScenarioOverride(); d.resetSim(); }}>Restore defaults</button></div>
    <div class="row"><input class="text" placeholder="New custom scenario name" bind:value={newName} /><button class="btn" onclick={() => { d.addCustomScenario(newName); newName = ""; d.resetSim(); }}>Duplicate</button></div>
  </div>
  <div class="sec">
    <h4>Supported preview subset</h4>
    {#each Object.entries(SUPPORT) as [k, v] (k)}<div class="sup"><span class="mono">{k}</span><span class="faint">{v.kinds.join(", ")}{v.secretInCombat ? " · secret in combat (game)" : ""}</span></div>{/each}
    <h4 class="gap">Simulated events</h4><div class="faint small mono">{SIMULATED_EVENTS.join(" · ")}</div>
    <h4 class="gap">Not simulated</h4>
    <ul class="faint small">{#each NOT_SIMULATED as n (n)}<li>{n}</li>{/each}</ul>
  </div>
</div>

<style>
  .body { flex: 1; } .small { font-size: 11.5px; } .wrap { flex-wrap: wrap; margin: 6px 0; } .spd { width: 70px; }
  .clock { margin-top: 6px; color: var(--cyan); font-size: 11px; }
  details { margin-bottom: 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); } summary { padding: 5px 9px; cursor: pointer; font-size: 12px; color: var(--dim); }
  label { display: grid; gap: 2px; padding: 3px 9px; font-size: 11px; color: var(--dim); } input[type="checkbox"] { justify-self: start; accent-color: var(--violet); }
  .sup { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 1px 0; } .sup .faint { text-align: right; } .gap { margin-top: 12px !important; } ul { margin: 4px 0; padding-left: 16px; }
</style>
