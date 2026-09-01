
    import { BlockNoteEditor } from "https://esm.sh/@blocknote/core@0.51.3?bundle";

    const DB_NAME = "notion-like-blocknote-db";
    const DB_VERSION = 1;
    const STORE = "pages";
    const ROOT = "root";

    const BLOCKS = [
      { key: "text",   icon: "T", label: "Text",       desc: "Plain text paragraph", type: "paragraph" },
      { key: "h1",     icon: "H1", label: "Heading 1",  desc: "Large section heading", type: "heading", props: { level: 1 } },
      { key: "h2",     icon: "H2", label: "Heading 2",  desc: "Medium section heading", type: "heading", props: { level: 2 } },
      { key: "h3",     icon: "H3", label: "Heading 3",  desc: "Small section heading", type: "heading", props: { level: 3 } },
      { key: "bullet", icon: "•",  label: "Bulleted list", desc: "Simple bullet list", type: "bulletListItem" },
      { key: "number", icon: "1.", label: "Numbered list", desc: "Ordered list", type: "numberedListItem" },
      { key: "todo",   icon: "☐", label: "To-do",       desc: "Task with checkbox", type: "checkListItem" },
      { key: "quote",  icon: "“", label: "Quote",       desc: "Quoted text", type: "quote" },
      { key: "code",   icon: "</>", label: "Code",      desc: "Monospace code block", type: "codeBlock" },
    ];

    const state = {
      pages: new Map(),
      currentPageId: null,
      editor: null,
      saveTimer: null,
      dirty: false,
      expanded: new Set([ROOT]),
      contextPageId: null,
      slashIndex: 0,
      slashFilter: ""
    };

    const $ = (sel) => document.querySelector(sel);

    function uid(prefix="page") {
      return prefix + "_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
    }

    function defaultBlocks(title) {
      return [
        { type: "paragraph", content: title === "Welcome" ? "This is a Notion-like block editor running from one HTML file." : "" },
        ...(title === "Welcome" ? [
          { type: "heading", props: { level: 2 }, content: "What works" },
          { type: "bulletListItem", content: "Block-based editing with BlockNote core" },
          { type: "bulletListItem", content: "Slash command menu" },
          { type: "bulletListItem", content: "Nested pages in the sidebar" },
          { type: "bulletListItem", content: "Automatic IndexedDB saving" },
        ] : [])
      ];
    }

    function makePage({ id=uid(), title="Untitled", parentId=ROOT, emoji="📄", blocks=defaultBlocks(title), collapsed=false }={}) {
      return { id, title, parentId, emoji, blocks, collapsed, updatedAt: Date.now() };
    }

    function openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function dbGetAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    async function dbPut(page) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(page);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function dbDelete(id) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    function setSaveState(text) { $("#saveState").textContent = text; }

    function markDirty() {
      state.dirty = true;
      setSaveState("Unsaved");
      clearTimeout(state.saveTimer);
      state.saveTimer = setTimeout(saveCurrent, 550);
    }

    async function saveCurrent() {
      const page = state.pages.get(state.currentPageId);
      if (!page || !state.editor) return;
      page.blocks = structuredClone(state.editor.document);
      page.title = $("#pageTitle").value.trim() || "Untitled";
      page.updatedAt = Date.now();
      state.pages.set(page.id, page);
      await dbPut(page);
      state.dirty = false;
      setSaveState("Saved · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      renderTree();
      renderBreadcrumbs();
    }

    async function saveAll() {
      for (const page of state.pages.values()) {
        await dbPut(page);
      }
      state.dirty = false;
      setSaveState("All pages saved");
    }

    function childrenOf(parentId) {
      return [...state.pages.values()]
        .filter(p => p.parentId === parentId)
        .sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    function renderTree() {
      const root = $("#pageTree");
      root.innerHTML = "";
      const walk = (parentId, depth) => {
        for (const page of childrenOf(parentId)) {
          const children = childrenOf(page.id);
          const row = document.createElement("div");
          row.className = "tree-row" + (page.id === state.currentPageId ? " active" : "");
          row.dataset.id = page.id;

          const indent = document.createElement("div");
          indent.className = "tree-indent";
          indent.style.width = (depth * 18) + "px";

          const twisty = document.createElement("button");
          twisty.className = "twisty" + (children.length ? "" : " placeholder");
          twisty.textContent = children.length ? (state.expanded.has(page.id) ? "▾" : "▸") : "";
          twisty.title = children.length ? "Expand / collapse" : "";
          if (children.length) {
            twisty.addEventListener("click", (e) => {
              e.stopPropagation();
              state.expanded.has(page.id) ? state.expanded.delete(page.id) : state.expanded.add(page.id);
              renderTree();
            });
          }

          const emoji = document.createElement("span");
          emoji.className = "page-emoji";
          emoji.textContent = page.emoji;

          const link = document.createElement("div");
          link.className = "page-link";
          link.textContent = page.title || "Untitled";
          link.title = page.title || "Untitled";
          link.addEventListener("click", () => openPage(page.id));

          const more = document.createElement("button");
          more.className = "page-more";
          more.textContent = "•••";
          more.title = "Page actions";
          more.addEventListener("click", (e) => {
            e.stopPropagation();
            openContextMenu(e.clientX, e.clientY, page.id);
          });

          row.append(indent, twisty, emoji, link, more);
          root.appendChild(row);

          if (children.length && state.expanded.has(page.id)) walk(page.id, depth + 1);
        }
      };
      walk(ROOT, 0);
    }

    function renderBreadcrumbs() {
      const page = state.pages.get(state.currentPageId);
      if (!page) return;
      const crumbs = [];
      let cursor = page;
      while (cursor && cursor.id !== ROOT) {
        crumbs.unshift(cursor);
        cursor = state.pages.get(cursor.parentId);
      }
      const el = $("#breadcrumbs");
      el.innerHTML = "";
      crumbs.forEach((crumb, i) => {
        const s = document.createElement("span");
        s.textContent = crumb.title || "Untitled";
        if (i === crumbs.length - 1) s.className = "crumb-current";
        el.appendChild(s);
        if (i < crumbs.length - 1) {
          const sep = document.createElement("span");
          sep.textContent = "/";
          el.appendChild(sep);
        }
      });
    }

    async function mountEditor(blocks) {
      if (state.editor) {
        try { state.editor.unmount(); } catch {}
        state.editor = null;
      }
      $("#editor").innerHTML = "";
      state.editor = BlockNoteEditor.create({ initialContent: blocks && blocks.length ? blocks : [{type:"paragraph"}] });
      state.editor.mount($("#editor"));
      state.editor.onChange(() => {
        if (state.currentPageId) markDirty();
      });
      wireEditorInteractions();
    }

    async function openPage(id) {
      if (state.dirty) await saveCurrent();
      const page = state.pages.get(id);
      if (!page) return;
      state.currentPageId = id;
      $("#pageTitle").value = page.title || "Untitled";
      await mountEditor(structuredClone(page.blocks));
      state.expanded.add(page.id);
      renderTree();
      renderBreadcrumbs();
      $("#workspace").scrollTop = 0;
      setSaveState("Loaded");
    }

    async function createPage(parentId=ROOT) {
      const page = makePage({ parentId, title: "Untitled", blocks: [{type:"paragraph", content:""}] });
      state.pages.set(page.id, page);
      state.expanded.add(parentId);
      await dbPut(page);
      await openPage(page.id);
      setTimeout(() => $("#pageTitle").focus(), 60);
    }

    async function deletePage(id) {
      if (id === state.currentPageId) {
        const fallback = childrenOf(ROOT).find(p => p.id !== id);
        if (!fallback) return;
        await openPage(fallback.id);
      }
      const descendants = [];
      const collect = (parentId) => {
        for (const child of childrenOf(parentId)) {
          descendants.push(child.id);
          collect(child.id);
        }
      };
      collect(id);
      for (const did of [id, ...descendants]) {
        state.pages.delete(did);
        await dbDelete(did);
      }
      const remaining = childrenOf(ROOT);
      if (!remaining.length) {
        const welcome = makePage({ id: "welcome", title: "Welcome", parentId: ROOT, emoji: "👋" });
        state.pages.set(welcome.id, welcome);
        await dbPut(welcome);
      }
      await openPage(state.currentPageId || childrenOf(ROOT)[0].id);
      renderTree();
    }

    function openContextMenu(x, y, pageId) {
      const menu = $("#contextMenu");
      state.contextPageId = pageId;
      menu.innerHTML = "";
      const actions = [
        ["New sub-page", () => createPage(pageId)],
        ["Rename", () => { openPage(pageId).then(() => { const input = $("#pageTitle"); input.focus(); input.select(); }); }],
        ["Delete page", () => { if (confirm("Delete this page and all nested pages?")) deletePage(pageId); }],
      ];
      actions.forEach(([label, fn], idx) => {
        const b = document.createElement("button");
        b.className = "context-item" + (idx === 2 ? " context-danger" : "");
        b.textContent = label;
        b.addEventListener("click", () => { closeContextMenu(); fn(); });
        menu.appendChild(b);
      });
      menu.style.left = Math.min(x, window.innerWidth - 195) + "px";
      menu.style.top = Math.min(y, window.innerHeight - 130) + "px";
      menu.classList.add("open");
    }
    function closeContextMenu() { $("#contextMenu").classList.remove("open"); }

    function getCurrentBlock() {
      try { return state.editor?.getTextCursorPosition()?.block || null; } catch { return null; }
    }

    function currentBlockText(block) {
      if (!block) return "";
      if (typeof block.content === "string") return block.content;
      if (Array.isArray(block.content)) return block.content.map(x => typeof x === "string" ? x : (x?.text || "")).join("");
      return "";
    }

    function filteredCommands() {
      const f = state.slashFilter.toLowerCase();
      return BLOCKS.filter(b => !f || (b.label + " " + b.desc).toLowerCase().includes(f));
    }

    function positionSlashMenu() {
      const menu = $("#slashMenu");
      let r = null;
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        r = sel.getRangeAt(0).getBoundingClientRect();
      }
      // Fallback when selection is empty (e.g., inside contenteditable after DOM updates)
      if ((!r || (r.width === 0 && r.height === 0)) && document.activeElement) {
        const active = document.activeElement;
        if (active && active.getBoundingClientRect) {
          const rect = active.getBoundingClientRect();
          if (rect && (rect.width > 0 || rect.height > 0)) {
            r = rect;
          }
        }
      }
      if (!r) return;
      const left = Math.min(Math.max(12, r.left), window.innerWidth - 312);
      const top = Math.min(Math.max(12, r.bottom + 8), window.innerHeight - 350);
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    }

    function renderSlashMenu() {
      const menu = $("#slashMenu");
      const cmds = filteredCommands();
      menu.innerHTML = "<div class='slash-header'>Basic blocks</div>";
      if (!cmds.length) {
        const empty = document.createElement("div");
        empty.className = "slash-header";
        empty.textContent = "No matching blocks";
        menu.appendChild(empty);
      }
      state.slashIndex = Math.max(0, Math.min(state.slashIndex, Math.max(0, cmds.length - 1)));
      cmds.forEach((cmd, i) => {
        const item = document.createElement("button");
        item.className = "slash-item" + (i === state.slashIndex ? " selected" : "");
        item.innerHTML = `<span class="slash-icon">${cmd.icon}</span><span class="slash-copy"><div class="slash-label"></div><div class="slash-desc"></div></span>`;
        item.querySelector(".slash-label").textContent = cmd.label;
        item.querySelector(".slash-desc").textContent = cmd.desc;
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          chooseSlash(cmd);
        });
        menu.appendChild(item);
      });
      menu.classList.add("open");
      positionSlashMenu();
    }

    function closeSlashMenu() {
      $("#slashMenu").classList.remove("open");
      try {
        const block = getCurrentBlock();
        if (block) {
          // If there's leftover filter text (e.g., user typed then pressed Esc), clear it.
          const txt = currentBlockText(block);
          if (txt) {
            state.editor.updateBlock(block, { content: "" });
            state.editor.setTextCursorPosition(block.id, "start");
          }
        }
      } catch {}
      state.slashFilter = "";
      state.slashIndex = 0;
    }

    function chooseSlash(command) {
      const block = getCurrentBlock();
      if (!block) return closeSlashMenu();
      try {
        state.editor.updateBlock(block, { type: command.type, props: command.props || {}, content: "" });
        state.editor.setTextCursorPosition(block.id, "start");
      } catch (err) {
        console.warn("Could not apply slash command", err);
      }
      closeSlashMenu();
    }

    function wireEditorInteractions() {
      const root = $("#editor");
      root.addEventListener("keydown", onEditorKeydown, true);
      root.addEventListener("keyup", onEditorKeyup, true);
      root.addEventListener("click", () => closeSlashMenu());
    }

    function onEditorKeydown(e) {
      if (!state.editor) return;
      const block = getCurrentBlock();
      const text = currentBlockText(block);
      const menuOpen = $("#slashMenu").classList.contains("open");

      if (menuOpen) {
        if (e.key === "ArrowDown") { e.preventDefault(); state.slashIndex++; renderSlashMenu(); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); state.slashIndex--; renderSlashMenu(); return; }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const cmd = filteredCommands()[state.slashIndex];
          if (cmd) chooseSlash(cmd);
          return;
        }
        if (e.key === "Escape") { e.preventDefault(); closeSlashMenu(); return; }
        if (e.key === "Backspace") {
          const next = text.length ? text.slice(0, -1) : "";
          state.slashFilter = next;
          state.slashIndex = 0;
          setTimeout(() => renderSlashMenu(), 0);
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          state.slashFilter += e.key;
          state.slashIndex = 0;
          setTimeout(() => renderSlashMenu(), 0);
          return;
        }
      }

      if (e.key === "/") {
        // Only open the slash palette for a new/empty paragraph-like block or at the beginning of text.
        const isStart = text.trim() === "" || text.trim() === "/";
        if (isStart) {
          e.preventDefault();
          state.slashFilter = "";
          state.slashIndex = 0;
          setTimeout(renderSlashMenu, 0);
        }
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          if (state.editor.canUnnestBlock()) state.editor.unnestBlock();
        } else {
          if (state.editor.canNestBlock()) state.editor.nestBlock();
        }
      }
    }

    function onEditorKeyup() {
      if (!$("#slashMenu").classList.contains("open")) return;
      const block = getCurrentBlock();
      const text = currentBlockText(block);
      const next = text || "";
      if (next !== state.slashFilter) {
        state.slashFilter = next;
        state.slashIndex = 0;
        renderSlashMenu();
      } else {
        positionSlashMenu();
      }
    }
      }
    }

    async function initialize() {
      try {
        const rows = await dbGetAll();
        state.pages = new Map(rows.map(p => [p.id, p]));
      } catch (err) {
        console.error(err);
        alert("IndexedDB is unavailable. The editor can still work, but data will not persist.");
      }

      if (!state.pages.size) {
        const welcome = makePage({ id: "welcome", title: "Welcome", emoji: "👋", parentId: ROOT });
        const project = makePage({ title: "Project Notes", emoji: "🗂️", parentId: welcome.id, blocks: [
          { type: "heading", props:{level:2}, content:"A nested page" },
          { type: "paragraph", content:"Create child pages from the sidebar's ••• menu." }
        ]});
        state.pages.set(welcome.id, welcome);
        state.pages.set(project.id, project);
        await saveAll();
      }

      state.expanded.add(ROOT);
      const first = state.pages.get("welcome") || childrenOf(ROOT)[0];
      await openPage(first.id);
      setSaveState("Ready");
    }

    $("#newPageBtn").addEventListener("click", () => createPage(ROOT));
    $("#saveBtn").addEventListener("click", saveCurrent);
    $("#reloadBtn").addEventListener("click", async () => {
      const ok = !state.dirty || confirm("Reload the saved version and discard unsaved changes?");
      if (!ok) return;
      const rows = await dbGetAll();
      state.pages = new Map(rows.map(p => [p.id, p]));
      const current = state.currentPageId && state.pages.get(state.currentPageId) ? state.currentPageId : childrenOf(ROOT)[0]?.id;
      if (current) await openPage(current);
    });
    $("#collapseAll").addEventListener("click", () => {
      const allIds = new Set([...state.pages.values()].map(p => p.id));
      const collapsed = state.expanded.size === 1 && state.expanded.has(ROOT);
      if (collapsed) {
        state.expanded = new Set(allIds);
        $("#collapseAll").textContent = "−";
        $("#collapseAll").title = "Collapse all";
      } else {
        state.expanded = new Set([ROOT]);
        $("#collapseAll").textContent = "+";
        $("#collapseAll").title = "Show all";
      }
      renderTree();
    });
    $("#pageTitle").addEventListener("input", markDirty);
    $("#pageTitle").addEventListener("blur", saveCurrent);

    document.addEventListener("mousedown", (e) => {
      const slash = $("#slashMenu");
      if (slash.classList.contains("open") && !slash.contains(e.target)) closeSlashMenu();
      const ctx = $("#contextMenu");
      if (ctx.classList.contains("open") && !ctx.contains(e.target)) closeContextMenu();
    });
    window.addEventListener("resize", () => {
      if ($("#slashMenu").classList.contains("open")) positionSlashMenu();
    });
    window.addEventListener("beforeunload", () => {
      // Fire-and-forget best effort. Browsers may terminate the page immediately.
      saveCurrent();
    });

    initialize();