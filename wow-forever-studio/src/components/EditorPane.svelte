<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { monaco, docs, saveDoc } from "../lib/monacoSetup";
  import { store } from "../lib/store.svelte";
  import { closeTab, findReferences, goToDefinition, saveActive } from "../lib/actions";

  let host: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let status = $state({ line: 1, col: 1 });

  onMount(() => {
    editor = monaco.editor.create(host, {
      theme: "forever", automaticLayout: true, fontSize: 13, lineHeight: 20,
      fontFamily: 'ui-monospace, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
      minimap: { enabled: true, scale: 1 }, scrollBeyondLastLine: false, renderWhitespace: "none",
      smoothScrolling: true, cursorSmoothCaretAnimation: "on", bracketPairColorization: { enabled: true },
      padding: { top: 8 }, tabSize: 4, insertSpaces: true, model: null,
    });
    editor.onDidChangeCursorPosition((e) => {
      status = { line: e.position.lineNumber, col: e.position.column };
      if (store.active) { store.cursor[store.active] = { line: e.position.lineNumber, col: e.position.column }; store.persist(); }
    });
    editor.addAction({ id: "wfs.def", label: "Go to Definition (project)", keybindings: [monaco.KeyCode.F12], run: (ed) => { const w = ed.getModel()?.getWordAtPosition(ed.getPosition()!); if (w) goToDefinition(w.word); } });
    editor.addAction({ id: "wfs.refs", label: "Find References (project)", keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12], contextMenuGroupId: "navigation", run: (ed) => { const w = ed.getModel()?.getWordAtPosition(ed.getPosition()!); if (w) void findReferences(w.word); } });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveActive(); });
    // Ctrl+Click go to definition
    editor.onMouseDown((e) => {
      if ((e.event.ctrlKey || e.event.metaKey) && e.target.position) {
        const w = editor!.getModel()?.getWordAtPosition(e.target.position);
        if (w) goToDefinition(w.word);
      }
    });
  });
  onDestroy(() => editor?.dispose());

  $effect(() => {
    const p = store.active;
    if (!editor) return;
    const d = p ? docs.get(p) : undefined;
    editor.setModel(d?.model ?? null);
    if (d && p) {
      const c = store.cursor[p];
      if (c) { editor.setPosition({ lineNumber: c.line, column: c.col }); editor.revealPositionInCenterIfOutsideViewport({ lineNumber: c.line, column: c.col }); }
      editor.focus();
    }
  });
  $effect(() => {
    const j = store.jump;
    if (!j || !editor) return;
    if (store.active === j.path) { editor.setPosition({ lineNumber: j.line, column: j.col }); editor.revealLineInCenter(j.line); editor.focus(); }
  });
  // external markers from the last full validation, for files without a live buffer check
  $effect(() => {
    const r = store.report;
    if (!r) return;
    const by = new Map<string, typeof r.diagnostics>();
    for (const d of r.diagnostics) if (d.file) (by.get(d.file) ?? by.set(d.file, []).get(d.file)!).push(d);
    for (const [path, doc] of docs) {
      if (path.endsWith(".lua")) continue;
      monaco.editor.setModelMarkers(doc.model, "wfs", (by.get(path) ?? []).map((d) => ({
        severity: d.severity === "error" ? 8 : d.severity === "warning" ? 4 : 2, message: d.message, code: d.code, source: d.source,
        startLineNumber: d.line || 1, startColumn: 1, endLineNumber: d.line || 1, endColumn: doc.model.getLineMaxColumn(d.line || 1),
      })));
    }
  });
</script>

<div class="pane">
  <div class="tabs">
    {#each store.tabs as t (t.path)}
      <div class="tab" class:on={store.active === t.path} class:dirty={t.dirty} title={t.path}>
        <button class="tl" onclick={() => { store.active = t.path; store.persist(); }}>
          <span>{t.path.split("/").pop()}</span>
        </button>
        <button class="x" aria-label="Close" onclick={() => closeTab(t.path)}>{t.dirty ? "●" : "×"}</button>
      </div>
    {/each}
  </div>
  <div class="ed" class:hidden={!store.active} bind:this={host}></div>
  {#if !store.active}<div class="empty">Select a file in the Explorer, or press <span class="kbd">Ctrl+P</span> to open by name.</div>{/if}
  <div class="status">
    <span>{store.active ?? ""}</span><span class="grow"></span>
    {#if store.active}<span>Ln {status.line}, Col {status.col}</span>{/if}
    <span>{store.counts.error} errors · {store.counts.warning} warnings</span>
    <span>API build {store.api?.meta.build ?? "…"} ({store.apiOrigin})</span>
    <span class="badge green">offline</span>
  </div>
</div>

<style>
  .pane { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; position: relative; }
  .tabs { display: flex; height: 34px; background: var(--panel); border-bottom: 1px solid var(--border); overflow-x: auto; flex: none; }
  .tab { display: flex; align-items: center; border-right: 1px solid var(--border); color: var(--dim); }
  .tab.on { background: #0f1117; color: var(--text); box-shadow: inset 0 -2px 0 var(--violet); }
  .tab .tl { padding: 0 4px 0 12px; height: 100%; color: inherit; font-size: 12.5px; }
  .tab .x { width: 22px; height: 22px; margin-right: 6px; border-radius: 5px; color: var(--faint); font-size: 14px; line-height: 1; }
  .tab .x:hover { background: var(--raised); color: var(--text); }
  .tab.dirty .x { color: var(--cyan); }
  .ed { flex: 1; min-height: 0; }
  .ed.hidden { display: none; }
  .empty { flex: 1; display: grid; place-items: center; }
  .status { display: flex; gap: 14px; align-items: center; height: 24px; padding: 0 12px; background: var(--panel); border-top: 1px solid var(--border); font-size: 11.5px; color: var(--dim); flex: none; white-space: nowrap; overflow: hidden; }
  .grow { flex: 1; }
</style>
