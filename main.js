const { Plugin, TFile, TFolder } = require("obsidian");

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

// "🫀 Cardiologie" → "Cardiologie" : on saute tout ce qui n'est ni lettre ni chiffre en tête
const key = (name) => name.replace(/^[^\p{L}\p{N}]+/u, "") || name;
const compareNames = (a, b) => collator.compare(key(a), key(b)) || collator.compare(a, b);
// Folder note du module Folder notes : note du même nom rangée dans le dossier
const hasFolderNote = (folder) =>
  folder.children.some((c) => c instanceof TFile && c.extension === "md" && c.basename === folder.name);

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
    // Ne restaure que si le tri en place est bien le nôtre
    if (this.proto && this.proto.getSortedFolderItems === this.patched) {
      this.proto.getSortedFolderItems = this.original;
      this.resort();
    }
  }

  explorers() {
    return this.app.workspace.getLeavesOfType("file-explorer").map((leaf) => leaf.view);
  }

  // L'explorateur peut être « différé » au démarrage (onglet non affiché, barre repliée) :
  // sa vraie vue n'existe pas encore, il faut la charger avant de pouvoir modifier son tri
  async patch() {
    if (this.patched) return;
    const leaf = this.app.workspace.getLeavesOfType("file-explorer")[0];
    if (!leaf) {
      // Explorateur fermé : on réessaie quand il revient
      if (!this.waiting) {
        this.waiting = true;
        this.registerEvent(this.app.workspace.on("layout-change", () => this.patch()));
      }
      return;
    }
    if (typeof leaf.loadIfDeferred === "function") await leaf.loadIfDeferred();
    const view = leaf.view;
    if (this.patched || !view || typeof view.getSortedFolderItems !== "function") {
      if (!this.patched) console.warn("[tri-sans-emoji] Explorateur de fichiers introuvable ou API modifiée");
      return;
    }
    const proto = Object.getPrototypeOf(view);
    const original = proto.getSortedFolderItems;
    this.proto = proto;
    this.original = original;

    this.patched = proto.getSortedFolderItems = function (folder) {
      const items = original.call(this, folder);
      const order = this.sortOrder;
      const alpha = order === "alphabetical" || order === "alphabeticalReverse";
      const dir = order === "alphabeticalReverse" ? -1 : 1;
      // Dossiers simples d'abord, toujours de A à Z. En tri alphabétique, un dossier avec
      // folder note (« Dossier/Dossier.md ») se range parmi les notes, comme une note.
      // En tri par date : ordre d'Obsidian conservé pour les fichiers (le tri est stable)
      const top = (f) => f instanceof TFolder && !(alpha && hasFolderNote(f));
      const label = (f) => (f instanceof TFolder ? f.name : f.basename);
      return items.slice().sort((a, b) => {
        const ta = top(a.file);
        const tb = top(b.file);
        if (ta !== tb) return ta ? -1 : 1;
        if (ta) return compareNames(a.file.name, b.file.name);
        const fa = a.file instanceof TFolder;
        const fb = b.file instanceof TFolder;
        if (!alpha && fa !== fb) return fa ? -1 : 1;
        if (!alpha) return fa ? compareNames(a.file.name, b.file.name) : 0;
        return dir * compareNames(label(a.file), label(b.file));
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
