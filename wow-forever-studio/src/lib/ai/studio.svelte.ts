import { ipc, errText } from "../ipc";
import { designer } from "../designer.svelte";
import { store } from "../store.svelte";
import { assertSafePayload, parseReply, repairTurn, systemPrompt, userTurn, type ChatMessage } from "./prompt";
import type { ApplyResult } from "./actions";
import type { AiStatus } from "../types";

export interface Bubble { role: "user" | "assistant" | "note"; text: string; kind?: "ok" | "warn" | "error" }
const MAX_REPAIRS = 2;
const HISTORY_TURNS = 6;

/** A model-agnostic function so tests can drive the whole loop with a scripted fake instead of a real model. */
export type Chat = (messages: ChatMessage[], onDelta: (d: string) => void) => Promise<string>;

export interface TurnDeps {
  chat: Chat;
  applyBatch: (actions: unknown) => ApplyResult;
  sceneContextArgs: () => { scene: Parameters<typeof userTurn>[1]; scenario: string; issues: { severity: string; code: string; message: string }[] };
  templates: Parameters<typeof systemPrompt>[0];
  history: ChatMessage[];
  onDelta?: (d: string) => void;
  isCancelled?: () => boolean;
}
export interface TurnResult { say: string; applied: ApplyResult | null; attempts: number; failure?: string }

/** One user request -> (reply -> validate -> apply), repairing the model's mistakes up to MAX_REPAIRS times. */
export async function runTurn(request: string, d: TurnDeps): Promise<TurnResult> {
  const a = d.sceneContextArgs();
  const msgs: ChatMessage[] = [{ role: "system", content: systemPrompt(d.templates) }, ...d.history.slice(-HISTORY_TURNS * 2), { role: "user", content: userTurn(request, a.scene, a.scenario, a.issues) }];
  let attempts = 0, lastSay = "";
  for (;;) {
    attempts++;
    assertSafePayload(msgs);
    const text = await d.chat(msgs, d.onDelta ?? (() => {}));
    if (d.isCancelled?.()) return { say: lastSay, applied: null, attempts, failure: "cancelled" };
    const reply = parseReply(text);
    lastSay = reply.say || lastSay;
    msgs.push({ role: "assistant", content: text.slice(0, 6000) });
    if (!reply.actions) {
      if (attempts > MAX_REPAIRS) return { say: lastSay, applied: null, attempts, failure: reply.problem };
      msgs.push({ role: "user", content: `${reply.problem} Reply with ONE JSON object: {"say": "...", "actions": [...]}.` });
      continue;
    }
    if (reply.actions.length === 0) return { say: reply.say, applied: null, attempts };
    const r = d.applyBatch(reply.actions);
    if (!r.errors.length) return { say: reply.say, applied: r, attempts };
    if (attempts > MAX_REPAIRS) return { say: reply.say, applied: null, attempts, failure: `The model's actions kept failing validation: ${r.errors.slice(0, 3).map((e) => e.message).join("; ")}` };
    msgs.push({ role: "user", content: repairTurn(r.errors) });
  }
}

class Studio {
  status = $state<AiStatus | null>(null);
  models = $state<string[]>([]);
  providerId = $state("ollama");
  bubbles = $state<Bubble[]>([]);
  busy = $state(false);
  streamChars = $state(0);
  history: ChatMessage[] = [];
  private cancelled = false;

  provider = $derived(this.status?.providers.find((p) => p.id === this.providerId) ?? null);
  ready = $derived(!!this.status?.enabled && !!this.provider?.enabled && !!this.provider?.model);

  async refresh() { try { this.status = await ipc.aiStatus(); const first = this.status.providers.find((p) => p.enabled); if (first && !this.provider?.enabled) this.providerId = first.id; } catch (e) { store.fail(e); } }
  async loadModels() { try { this.models = await ipc.aiListModels(this.providerId); } catch (e) { this.models = []; this.note(errText(e), "error"); } }
  note(text: string, kind: Bubble["kind"] = "ok") { this.bubbles.push({ role: "note", text, kind }); }

  async send(request: string) {
    const text = request.trim();
    if (!text || this.busy) return;
    if (!this.ready) { this.note("AI is not ready. Turn it on in Settings, enable a provider and choose a model.", "warn"); return; }
    this.bubbles.push({ role: "user", text });
    this.busy = true; this.cancelled = false; this.streamChars = 0;
    try {
      const res = await runTurn(text, {
        chat: (m, onDelta) => ipc.aiChat(this.providerId, m, onDelta),
        applyBatch: (a) => designer.applyBatch(a),
        sceneContextArgs: () => ({ scene: designer.scene, scenario: designer.scenarioId, issues: designer.previewIssues }),
        templates: designer.templates,
        history: this.history,
        onDelta: (d) => { this.streamChars += d.length; },
        isCancelled: () => this.cancelled,
      });
      this.history.push({ role: "user", content: text }, { role: "assistant", content: JSON.stringify({ say: res.say, actions: [] }) });
      if (res.failure === "cancelled") this.note("Stopped.", "warn");
      else if (res.failure) this.bubbles.push({ role: "assistant", text: res.say || "I couldn't do that.", kind: "error" }), this.note(res.failure, "error");
      else {
        this.bubbles.push({ role: "assistant", text: res.say || "Done." });
        if (res.applied) { const a = res.applied; this.note(`+${a.created.length} added · ~${a.changed.length} changed · −${a.removed.length} removed${res.attempts > 1 ? ` · fixed after ${res.attempts - 1} retr${res.attempts === 2 ? "y" : "ies"}` : ""}`); if (a.scenarioId) designer.play(); }
      }
    } catch (e) { this.note(errText(e), "error"); } finally { this.busy = false; }
  }
  async stop() { this.cancelled = true; try { await ipc.aiCancel(); } catch { /* nothing to cancel */ } }
  clear() { this.bubbles = []; this.history = []; }
}
export const studio = new Studio();
