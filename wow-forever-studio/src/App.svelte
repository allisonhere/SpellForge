<script lang="ts">
  import { onMount } from "svelte";
  import { ipc } from "./lib/ipc";
  import { store } from "./lib/store.svelte";
  import { commands, openFile, openRecent } from "./lib/actions";
  import "./lib/monacoSetup";
  import Toolbar from "./components/Toolbar.svelte";
  import Splitter from "./components/Splitter.svelte";
  import Explorer from "./components/Explorer.svelte";
  import ApiBrowser from "./components/ApiBrowser.svelte";
  import SearchPanel from "./components/SearchPanel.svelte";
  import UiSourcePanel from "./components/UiSourcePanel.svelte";
  import EditorPane from "./components/EditorPane.svelte";
  import TocPanel from "./components/TocPanel.svelte";
  import DocsPanel from "./components/DocsPanel.svelte";
  import OutlinePanel from "./components/OutlinePanel.svelte";
  import BottomDock from "./components/BottomDock.svelte";
  import Welcome from "./components/Welcome.svelte";
  import Palette from "./components/Palette.svelte";
  import Settings from "./components/Settings.svelte";
  import DeployDialog from "./components/DeployDialog.svelte";
  import NewAddon from "./components/NewAddon.svelte";
  import Toast from "./components/Toast.svelte";
  import Designer from "./components/Designer.svelte";

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  onMount(async () => {
    try {
      const boot = await ipc.boot();
      store.api = JSON.parse(await ipc.apiIndex());
      store.apiOrigin = boot.apiOrigin;
      store.notes = JSON.parse(await ipc.compatNotes()).notes;
      store.recent = boot.settings.recentProjects;
      store.installations = boot.settings.installations;
      store.detected = boot.detected;
      Object.assign(store.ui, Object.fromEntries(Object.entries(boot.settings.ui ?? {}).filter(([k]) => k in store.ui)));
      const saved = boot.settings.ui;
      store.cursor = saved?.cursor ?? {};
      if (saved?.view === "design") store.view = "design";
      store.extra = { preview: saved?.preview, scenarioId: saved?.scenarioId, autoplay: saved?.autoplay, autoprompt: saved?.autoprompt };
      const last = boot.settings.lastProject;
      if (last && boot.settings.recentProjects.includes(last)) {
        await openRecent(last);
        for (const f of saved?.openFiles ?? []) if (!store.tabs.some((t) => t.path === f)) await openFile(f);
        if (saved?.activeFile && store.tabs.some((t) => t.path === saved.activeFile)) store.active = saved.activeFile;
        store.say("info", "Workspace restored");
      }
    } catch (e) { store.fail(e); }
    store.ready = true;
  });

  function keydown(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    const run = (id: string) => { e.preventDefault(); void commands.find((c) => c.id === id)?.run(); };
    if (k === "p" && e.shiftKey) { e.preventDefault(); store.palettePrefix = ">"; store.modal = "palette"; }
    else if (k === "p") { e.preventDefault(); store.palettePrefix = ""; store.modal = "palette"; }
    else if (k === "t") { e.preventDefault(); store.palettePrefix = "@"; store.modal = "palette"; }
    else if (k === "s" && e.shiftKey) run("saveAll");
    else if (k === "s") run("save");
    else if (k === "o") run("open");
    else if (k === "b" && e.altKey) run("toggleRight");
    else if (k === "b") run("toggleLeft");
    else if (k === "j") run("toggleBottom");
    else if (k === "," ) run("settings");
    else if (k === "v" && e.shiftKey) run("validate");
    else if (k === "f" && e.shiftKey) run("search");
    else if (k === "a" && e.shiftKey) run("api");
  }
  const leftTabs: [string, string][] = [["explorer", "Explorer"], ["api", "API"], ["search", "Search"], ["ui", "UI"]];
  const rightTabs: [string, string][] = [["toc", "TOC"], ["docs", "Docs"], ["outline", "Outline"]];
</script>

<svelte:window onkeydown={keydown} />

<div class="shell">
  <Toolbar />
  <div class="main">
    {#if store.project && store.ui.showLeft}
      <aside class="side" style="width:{store.ui.leftWidth}px">
        <div class="panel-h">{#each leftTabs as [id, label] (id)}<button class="tabbtn" class:on={store.ui.leftTab === id} onclick={() => { store.ui.leftTab = id; store.persist(); }}>{label}</button>{/each}</div>
        {#if store.ui.leftTab === "explorer"}<Explorer />{:else if store.ui.leftTab === "api"}<ApiBrowser />{:else if store.ui.leftTab === "ui"}<UiSourcePanel />{:else}<SearchPanel />{/if}
      </aside>
      <Splitter dir="v" onresize={(d) => { store.ui.leftWidth = clamp(store.ui.leftWidth + d, 180, 560); store.persist(); }} />
    {/if}
    <section class="center">
      {#if !store.project}
        <Welcome />
      {:else}
        <div class="vw" class:off={store.view !== "code"}><EditorPane /></div>
        {#if store.view === "design"}<Designer />{/if}
        {#if store.ui.showBottom}
          <Splitter dir="h" onresize={(d) => { store.ui.bottomHeight = clamp(store.ui.bottomHeight - d, 90, 600); store.persist(); }} />
          <div class="dock" style="height:{store.ui.bottomHeight}px"><BottomDock /></div>
        {/if}
      {/if}
    </section>
    {#if store.project && store.ui.showRight}
      <Splitter dir="v" onresize={(d) => { store.ui.rightWidth = clamp(store.ui.rightWidth - d, 220, 620); store.persist(); }} />
      <aside class="side" style="width:{store.ui.rightWidth}px">
        <div class="panel-h">{#each rightTabs as [id, label] (id)}<button class="tabbtn" class:on={store.ui.rightTab === id} onclick={() => { store.ui.rightTab = id; store.persist(); }}>{label}</button>{/each}</div>
        {#if store.ui.rightTab === "toc"}<TocPanel />{:else if store.ui.rightTab === "docs"}<DocsPanel />{:else}<OutlinePanel />{/if}
      </aside>
    {/if}
  </div>
</div>

<Toast />
{#if store.modal === "palette"}<Palette />{/if}
{#if store.modal === "settings"}<Settings />{/if}
{#if store.modal === "deploy"}<DeployDialog />{/if}
{#if store.modal === "new"}<NewAddon />{/if}

<style>
  .shell { display: flex; flex-direction: column; height: 100%; }
  .main { display: flex; flex: 1; min-height: 0; }
  .side { display: flex; flex-direction: column; background: var(--panel); min-height: 0; flex: none; border-right: 1px solid var(--border); }
  .main > .side:last-child { border-right: 0; border-left: 1px solid var(--border); }
  .vw { display: flex; flex: 1; min-height: 0; min-width: 0; } .vw.off { display: none; }
  .center { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .dock { display: flex; flex-direction: column; flex: none; border-top: 1px solid var(--border); background: var(--panel); min-height: 0; }
</style>
