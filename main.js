const { Plugin, TFolder } = require("obsidian");

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

// "🫀 Cardiologie" → "Cardiologie" : on saute tout ce qui n'est ni lettre ni chiffre en tête
const key = (name) => name.replace(/^[^\p{L}\p{N}]+/u, "") || name;
const compareNames = (a, b) => collator.compare(key(a), key(b)) || collator.compare(a, b);

module.exports = class TriSansEmoji extends Plugin {
  onload() {
    this.app.workspace.onLayoutReady(() => this.patch());
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
