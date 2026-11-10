// Addon-owned textures and fonts for the canvas. Only files inside the open addon are ever read (enforced in Rust).
// Blizzard's own art is not available (encrypted in the client), so those paths resolve to nothing and the canvas uses placeholders.
import { invoke } from "@tauri-apps/api/core";
import { ipc } from "./ipc";
import { decodeTga } from "./tga";

type Slot = string | null | undefined; // undefined = not requested yet, null = unavailable
class Assets {
  images = $state<Record<string, Slot>>({});
  fonts = $state<Record<string, Slot>>({});
  private pending = new Set<string>();
  /** Bumped when a project changes so stale entries are dropped. */
  reset() { this.images = {}; this.fonts = {}; this.pending.clear(); }

  /** Data URL for a texture path, or null/undefined while loading or unavailable. Reading this triggers the load. */
  image(gamePath: string | undefined): Slot {
    if (!gamePath) return null;
    const k = gamePath.toLowerCase();
    const cur = this.images[k];
    if (cur === undefined && !this.pending.has("i:" + k)) { this.pending.add("i:" + k); void this.loadImage(gamePath, k); }
    return cur;
  }
  /** CSS font-family for a font file path, or null/undefined. */
  font(gamePath: string | undefined): Slot {
    if (!gamePath) return null;
    const k = gamePath.toLowerCase();
    const cur = this.fonts[k];
    if (cur === undefined && !this.pending.has("f:" + k)) { this.pending.add("f:" + k); void this.loadFont(gamePath, k); }
    return cur;
  }

  private async bytes(gamePath: string): Promise<{ rel: string; buf: ArrayBuffer } | null> {
    try {
      const rel = await invoke<string | null>("resolve_asset", { gamePath });
      if (!rel) return null;
      return { rel, buf: await invoke<ArrayBuffer>("read_asset_bytes", { path: rel }) };
    } catch { return null; }
  }
  private async loadImage(gamePath: string, k: string) {
    let url: string | null = null;
    try {
      const a = await this.bytes(gamePath);
      if (a) {
        const lower = a.rel.toLowerCase();
        if (lower.endsWith(".tga")) {
          const t = decodeTga(a.buf);
          const c = document.createElement("canvas"); c.width = t.width; c.height = t.height;
          c.getContext("2d")!.putImageData(new ImageData(t.data as Uint8ClampedArray<ArrayBuffer>, t.width, t.height), 0, 0);
          url = c.toDataURL("image/png");
        } else if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
          url = URL.createObjectURL(new Blob([a.buf], { type: lower.endsWith(".png") ? "image/png" : "image/jpeg" }));
        }
      }
    } catch { url = null; }
    this.images[k] = url;
  }
  private async loadFont(gamePath: string, k: string) {
    let fam: string | null = null;
    try {
      const a = await this.bytes(gamePath);
      if (a && /\.(ttf|otf)$/i.test(a.rel)) {
        fam = "wfs-" + k.replace(/[^a-z0-9]/g, "");
        const face = new FontFace(fam, a.buf);
        await face.load();
        document.fonts.add(face);
      }
    } catch { fam = null; }
    this.fonts[k] = fam;
  }
}
export const assets = new Assets();
void ipc; // keep the IPC module initialised before the first asset request
