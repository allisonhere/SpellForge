import { describe, expect, it } from "vitest";
import { searchApi, provenance, notesFor } from "./apiSearch";
import type { ApiIndex } from "./types";
import real from "../../data/forever-api-index.json";

const idx = real as unknown as ApiIndex;

describe("API search over the bundled snapshot", () => {
  it("ranks exact matches first", () => {
    const h = searchApi(idx, "C_Spell.GetSpellInfo");
    expect(h[0]?.name).toBe("C_Spell.GetSpellInfo");
  });
  it("finds events and namespaces", () => {
    expect(searchApi(idx, "PLAYER_LOGIN", new Set(["event"]))[0]?.name).toBe("PLAYER_LOGIN");
    expect(searchApi(idx, "C_RestrictedActions", new Set(["namespace"]))[0]?.name).toBe("C_RestrictedActions");
  });
  it("does not report removed Classic globals as present", () => {
    const h = searchApi(idx, "GetItemInfo", new Set(["function"]));
    expect(h.find((x) => x.name === "GetItemInfo")).toBeUndefined();
    expect(h.find((x) => x.name === "C_Item.GetItemInfo")).toBeDefined();
  });
  it("describes provenance without claiming unsupported", () => {
    expect(provenance(4)).toContain("kit");
    expect(provenance(0)).toBe("unknown");
  });
  it("attaches compat notes", () => {
    const n = notesFor([{ id: "x", names: ["ReloadUI"], category: "protected", level: "measured", text: "t", source: "s" }], "ReloadUI");
    expect(n).toHaveLength(1);
  });
  it("carries provenance metadata", () => {
    expect(idx.meta.build).toBe("70790");
    expect(idx.meta.sources.length).toBe(2);
  });
});
