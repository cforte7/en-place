You can get there incrementally without building throwaway architecture:

V1: Client maintains a working graph. Explicit Save sends the entire graph. Backend validates and calls replaceGraph().
V2: Add recipe_drafts with a JSONB snapshot and draftVersion. Debounced autosave writes the entire working document.
V3: Add transparent promotion of valid drafts to the canonical normalized graph, giving you a true "Saved" experience even while the user edits.
Much later, only if needed: Replace snapshot synchronization with mutations/CRDTs for simultaneous collaborative editing.
