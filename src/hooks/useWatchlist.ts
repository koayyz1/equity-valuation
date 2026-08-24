import { useState, useCallback } from 'react';
import { WatchlistData, WatchlistEntry, DCFAssumptions, Overrides } from '../types';

const LISTS_KEY = 'ev-watchlists-v2';
const ACTIVE_KEY = 'ev-watchlist-active-v2';
const LEGACY_KEY = 'ev-watchlist-v1';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function makeDefault(): WatchlistData {
  return { id: uid(), name: 'Main', entries: [], createdAt: Date.now() };
}

function loadLists(): WatchlistData[] {
  try {
    const raw = localStorage.getItem(LISTS_KEY);
    if (raw) return JSON.parse(raw);

    // Migrate from v1 flat array
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const entries: WatchlistEntry[] = JSON.parse(legacy);
      const migrated: WatchlistData = { id: uid(), name: 'Main', entries, createdAt: Date.now() };
      return [migrated];
    }
  } catch {}
  return [makeDefault()];
}

function loadActiveId(lists: WatchlistData[]): string {
  try {
    const stored = localStorage.getItem(ACTIVE_KEY);
    if (stored && lists.some((l) => l.id === stored)) return stored;
  } catch {}
  return lists[0]?.id ?? '';
}

function persist(lists: WatchlistData[], activeId: string) {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
    localStorage.setItem(ACTIVE_KEY, activeId);
  } catch {}
}

export function useWatchlist() {
  const [lists, setLists] = useState<WatchlistData[]>(() => {
    const loaded = loadLists();
    return loaded.length ? loaded : [makeDefault()];
  });
  const [activeId, setActiveIdState] = useState<string>(() => {
    const loaded = loadLists();
    return loadActiveId(loaded.length ? loaded : [makeDefault()]);
  });

  const activeList = lists.find((l) => l.id === activeId) ?? lists[0];

  // ── List management ────────────────────────────────────────────
  const createList = useCallback((name = 'New List') => {
    const next: WatchlistData = { id: uid(), name: name.trim() || 'New List', entries: [], createdAt: Date.now() };
    setLists((prev) => {
      const updated = [...prev, next];
      persist(updated, next.id);
      return updated;
    });
    setActiveIdState(next.id);
  }, []);

  const renameList = useCallback((id: string, name: string) => {
    setLists((prev) => {
      const updated = prev.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l));
      persist(updated, activeId);
      return updated;
    });
  }, [activeId]);

  const deleteList = useCallback((id: string) => {
    setLists((prev) => {
      if (prev.length === 1) return prev; // keep at least one
      const updated = prev.filter((l) => l.id !== id);
      const newActiveId = activeId === id ? (updated[0]?.id ?? '') : activeId;
      persist(updated, newActiveId);
      setActiveIdState(newActiveId);
      return updated;
    });
  }, [activeId]);

  const setActiveList = useCallback((id: string) => {
    setActiveIdState(id);
    setLists((prev) => { persist(prev, id); return prev; });
  }, []);

  // ── Entry management (on active list) ─────────────────────────
  const mutateActive = useCallback((fn: (entries: WatchlistEntry[]) => WatchlistEntry[]) => {
    setLists((prev) => {
      const updated = prev.map((l) =>
        l.id === activeId ? { ...l, entries: fn(l.entries) } : l
      );
      persist(updated, activeId);
      return updated;
    });
  }, [activeId]);

  const add = useCallback(
    (ticker: string, name: string, currency: string, assumptions: DCFAssumptions, overrides: Overrides) => {
      mutateActive((entries) => {
        const filtered = entries.filter((e) => e.ticker !== ticker.toUpperCase());
        return [
          ...filtered,
          { ticker: ticker.toUpperCase(), name, currency, assumptions, overrides, addedAt: Date.now() },
        ];
      });
    },
    [mutateActive]
  );

  const remove = useCallback(
    (ticker: string) => {
      mutateActive((entries) => entries.filter((e) => e.ticker !== ticker.toUpperCase()));
    },
    [mutateActive]
  );

  const updateAssumptions = useCallback(
    (ticker: string, assumptions: DCFAssumptions) => {
      mutateActive((entries) =>
        entries.map((e) => (e.ticker === ticker.toUpperCase() ? { ...e, assumptions } : e))
      );
    },
    [mutateActive]
  );

  const updateNotes = useCallback(
    (ticker: string, notes: string) => {
      mutateActive((entries) =>
        entries.map((e) =>
          e.ticker === ticker.toUpperCase() ? { ...e, notes, notesAt: Date.now() } : e
        )
      );
    },
    [mutateActive]
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      mutateActive((entries) => {
        const next = [...entries];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [mutateActive]
  );

  const isWatched = useCallback(
    (ticker: string) => (activeList?.entries ?? []).some((e) => e.ticker === ticker.toUpperCase()),
    [activeList]
  );

  return {
    lists,
    activeList: activeList ?? lists[0],
    activeId,
    // list ops
    createList,
    renameList,
    deleteList,
    setActiveList,
    // entry ops on active list
    add,
    remove,
    updateAssumptions,
    updateNotes,
    reorder,
    isWatched,
  };
}
