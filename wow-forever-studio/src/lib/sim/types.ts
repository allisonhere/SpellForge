import type { Rgba } from "../scene";

export type PowerType = "MANA" | "RAGE" | "ENERGY";
export interface SimAura { spellId: number; name: string; harmful: boolean; stacks: number; duration: number; expires: number; color: Rgba }
export interface SimCast { spell: string; start: number; end: number; interruptible: boolean; channel: boolean; color: Rgba }
export interface SimUnit {
  id: string; name: string; class: string; role: "TANK" | "HEALER" | "DAMAGER"; level: number;
  health: number; maxHealth: number; /** Eases down toward health after damage (lag bar). */ lag: number; power: number; maxPower: number; powerType: PowerType;
  alive: boolean; hostile: boolean; auras: SimAura[]; cast: SimCast | null;
}
export interface SimEvent { t: number; name: string; args: string }
export interface SimState {
  t: number; tick: number; inCombat: boolean;
  units: Record<string, SimUnit>;
  cooldowns: Record<string, { start: number; duration: number }>;
  rng: number; log: SimEvent[]; respawnAt: number;
}

/** All fields are plain numbers/booleans so scenarios are editable and serialisable. 0 disables a mechanic. */
export interface Scenario {
  id: string; name: string; description: string; seed: number;
  group: "solo" | "party" | "raid"; groupSize: number;
  startInCombatAtMs: number; // -1 = never
  playerHealthPct: number; playerMaxHealth: number; playerPowerType: PowerType; playerPowerPct: number;
  targetName: string; targetMaxHealth: number; targetDpsPctPerSec: number;
  targetCastEveryMs: number; targetCastTimeMs: number; targetCastInterruptible: boolean; targetCastSpell: string;
  playerCastEveryMs: number; playerCastTimeMs: number; playerCastSpell: string;
  interruptTargetCasts: boolean;
  damageEveryMs: number; damagePctMin: number; damagePctMax: number; damagePlayerBias: number;
  healEveryMs: number; healPctMin: number; healPctMax: number;
  auraEveryMs: number; buffDurationMs: number; debuffDurationMs: number;
}
