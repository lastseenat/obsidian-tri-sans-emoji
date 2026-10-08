const { Plugin, TFolder } = require("obsidian");

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

// "🫀 Cardiologie" → "Cardiologie" : on saute tout ce qui n'est ni lettre ni chiffre en tête
const key = (name) => name.replace(/^[^\p{L}\p{N}]+/u, "") || name;
const compareNames = (a, b) => collator.compare(key(a), key(b)) || collator.compare(a, b);

module.exports = class TriSansEmoji extends Plugin {
  onload() {
    this.app.workspace.onLayoutReady(() => this.patch());
    this.addNoteCountToVaultTooltip();
  }

  // Infobulle du nom du coffre : « 748 fichiers, 30 dossiers » → « 748 fichiers (492 notes), 30 dossiers »
  addNoteCountToVaultTooltip() {
    let hovering = false;
    this.registerDomEvent(document, "mouseover", (evt) => {
      hovering = !!evt.target.closest?.(".workspace-drawer-vault-switcher");
    });
    const observer = new MutationObserver((mutations) => {
      if (!hovering) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1 || !node.classList.contains("tooltip")) continue;
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let text = null;
          while (!text && walker.nextNode()) {
            if (/\d+ (fichiers?|files?)/.test(walker.currentNode.textContent)) text = walker.currentNode;
          }
          if (!text || text.textContent.includes(" notes)")) continue;
          const count = this.app.vault.getMarkdownFiles().length;
          text.textContent = text.textContent.replace(/(\d+ (?:fichiers?|files?))/, `$1 (${count} notes)`);
        }
      }
    });
    observer.observe(document.body, { childList: true });
    this.register(() => observer.disconnect());
  }

  onunload() {
    if (this.proto && this.original) {
      this.proto.getSortedFolderItems = this.original;
      this.resort();
    }
  }

  explorers() {
    return this.app.workspace.getLeavesOfType("file-explorer").map((leaf) => leaf.view);
  }

  patch() {
    const view = this.explorers()[0];
    if (!view || typeof view.getSortedFolderItems !== "function") {
      console.warn("[tri-sans-emoji] Explorateur de fichiers introuvable ou API modifiée");
      return;
    }
    const proto = Object.getPrototypeOf(view);
    const original = proto.getSortedFolderItems;
    this.proto = proto;
    this.original = original;

    proto.getSortedFolderItems = function (folder) {
      const items = original.call(this, folder);
      const order = this.sortOrder;
      const alpha = order === "alphabetical" || order === "alphabeticalReverse";
      const dir = order === "alphabeticalReverse" ? -1 : 1;
      // Comme Obsidian : dossiers d'abord, toujours de A à Z ; fichiers selon l'ordre choisi
      // (tri par date conservé tel quel, le tri est stable)
      return items.slice().sort((a, b) => {
        const fa = a.file instanceof TFolder;
        const fb = b.file instanceof TFolder;
        if (fa !== fb) return fa ? -1 : 1;
        if (fa) return compareNames(a.file.name, b.file.name);
        return alpha ? dir * compareNames(a.file.name, b.file.name) : 0;
      });
    };
    this.resort();
  }

  resort() {
    for (const view of this.explorers()) {
      if (typeof view.requestSort === "function") view.requestSort();
    }
  }
};
