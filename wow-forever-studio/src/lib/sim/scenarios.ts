import type { Scenario } from "./types";

const base: Scenario = {
  id: "", name: "", description: "", seed: 1337, group: "solo", groupSize: 1,
  startInCombatAtMs: -1, playerHealthPct: 100, playerMaxHealth: 180000, playerPowerType: "MANA", playerPowerPct: 100,
  targetName: "Training Dummy", targetMaxHealth: 2000000, targetDpsPctPerSec: 0,
  targetCastEveryMs: 0, targetCastTimeMs: 2500, targetCastInterruptible: true, targetCastSpell: "Shadow Bolt",
  playerCastEveryMs: 0, playerCastTimeMs: 2000, playerCastSpell: "Fireball", interruptTargetCasts: false,
  damageEveryMs: 0, damagePctMin: 2, damagePctMax: 6, damagePlayerBias: 0.5,
  healEveryMs: 0, healPctMin: 4, healPctMax: 9,
  auraEveryMs: 0, buffDurationMs: 30000, debuffDurationMs: 12000,
};
const sc = (o: Partial<Scenario> & Pick<Scenario, "id" | "name" | "description">): Scenario => ({ ...base, ...o });

export const BUILTIN_SCENARIOS: Scenario[] = [
  sc({ id: "idle", name: "Idle", description: "Out of combat, full health, no activity. Useful for static layout work.", targetName: "Training Dummy" }),
  sc({ id: "solo-combat", name: "Solo combat", description: "Player fights one target: incoming melee hits, periodic casts, health/power movement, buff and debuff churn.", startInCombatAtMs: 1000, playerHealthPct: 92, targetDpsPctPerSec: 1.4, damageEveryMs: 1500, damagePctMin: 1.5, damagePctMax: 4.5, damagePlayerBias: 1, healEveryMs: 4000, healPctMin: 3, healPctMax: 7, playerCastEveryMs: 5000, auraEveryMs: 6000, targetName: "Gnarlroot Ravager", targetMaxHealth: 900000 }),
  sc({ id: "target-casting", name: "Target casting", description: "A hostile target casts every few seconds; every other cast is uninterruptible. The player kicks interruptible casts (Kick cooldown shown).", startInCombatAtMs: 500, targetCastEveryMs: 4500, targetCastTimeMs: 2800, interruptTargetCasts: true, targetDpsPctPerSec: 0.8, damageEveryMs: 2500, damagePctMin: 2, damagePctMax: 5, damagePlayerBias: 1, targetName: "Cult Fanatic", targetMaxHealth: 1200000 }),
  sc({ id: "party-5", name: "Five-player party", description: "Player plus four party members (tank, healer, two damage). Damage lands on the tank and others; the healer heals the lowest.", group: "party", groupSize: 5, startInCombatAtMs: 800, damageEveryMs: 900, damagePctMin: 3, damagePctMax: 8, damagePlayerBias: 0.3, healEveryMs: 1400, healPctMin: 6, healPctMax: 12, auraEveryMs: 2500, targetCastEveryMs: 6000, targetName: "Dungeon Boss", targetMaxHealth: 6000000, targetDpsPctPerSec: 0.9 }),
  sc({ id: "raid-40", name: "Forty-player raid", description: "Forty raid members with tanks, healers and damage dealers; frequent raid-wide damage and heavy aura churn.", group: "raid", groupSize: 40, startInCombatAtMs: 600, damageEveryMs: 250, damagePctMin: 4, damagePctMax: 14, damagePlayerBias: 0.05, healEveryMs: 350, healPctMin: 8, healPctMax: 16, auraEveryMs: 700, targetCastEveryMs: 9000, targetCastTimeMs: 4000, targetName: "Raid Boss", targetMaxHealth: 90000000, targetDpsPctPerSec: 0.25 }),
  sc({ id: "low-health", name: "Low-health emergency", description: "Player starts at 18% health under steady damage with slow healing; triggers low-health styling and death.", startInCombatAtMs: 300, playerHealthPct: 18, damageEveryMs: 1100, damagePctMin: 3, damagePctMax: 7, damagePlayerBias: 1, healEveryMs: 5200, healPctMin: 8, healPctMax: 14, targetName: "Gnarlroot Ravager", targetMaxHealth: 900000, targetDpsPctPerSec: 0.6 }),
  sc({ id: "aura-activity", name: "Buff / debuff activity", description: "Out of combat aura churn: buffs and debuffs are applied, refreshed and expire quickly to exercise aura frames.", auraEveryMs: 700, buffDurationMs: 9000, debuffDurationMs: 6000, group: "party", groupSize: 5 }),
];

export const mergeScenarios = (overrides: Scenario[] | undefined): Scenario[] => {
  const byId = new Map(BUILTIN_SCENARIOS.map((s) => [s.id, s]));
  for (const o of overrides ?? []) byId.set(o.id, { ...(byId.get(o.id) ?? base), ...o });
  return [...byId.values()];
};
export const scenarioDefaults = (id: string): Scenario | undefined => BUILTIN_SCENARIOS.find((s) => s.id === id);
