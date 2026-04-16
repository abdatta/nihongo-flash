import {
  buildStorageSnapshot,
  CUSTOM_ITEMS_STORAGE_KEY,
  type DebugExportKey,
  HAPTICS_SETTINGS_KEY,
  SETTINGS_STORAGE_KEY,
  SOUND_SETTINGS_KEY,
  STATS_STORAGE_KEY,
  STUDY_MODE_STORAGE_KEY,
  WORD_ITEMS_STORAGE_KEY,
} from './storageKeys';
import { DAY_IN_MS, DEFAULT_EASE, DEFAULT_SETTINGS, MIN_EASE, RECENT_RESULTS_LIMIT } from './appConstants';
import type { CardItem, CardStats, CardType, Direction, DirectionStats, SettingsState, StudyMode, StatsMap } from './types';

const SETTINGS_FIELDS = [
  'studyMode',
  'hiragana',
  'katakana',
  'kanji',
  'jlptN5Kanji',
  'showOnyomi',
  'showKunyomi',
  'dakuten',
  'handakuten',
  'yoon',
  'experimentalDeckBuilderEnabled',
  'soundEnabled',
  'hapticsEnabled',
] as const satisfies ReadonlyArray<keyof SettingsState>;

export type SettingsField = typeof SETTINGS_FIELDS[number];
export type ImportConflictChoice = 'local' | 'imported';

export interface ImportedAppState {
  settings: SettingsState;
  stats: StatsMap;
  customItems: CardItem[];
  wordItems: CardItem[];
}

export type ImportConflict =
  | {
    id: string;
    kind: 'settings';
    field: SettingsField;
    localValue: SettingsState[SettingsField];
    importedValue: SettingsState[SettingsField];
  }
  | {
    id: string;
    kind: 'customItem' | 'wordItem';
    itemId: string;
    localValue: CardItem;
    importedValue: CardItem;
  }
  | {
    id: string;
    kind: 'stats';
    cardId: string;
    direction: Direction;
    localValue: DirectionStats;
    importedValue: DirectionStats;
  };

export interface StorageImportPlan {
  importedState: ImportedAppState;
  mergedState: ImportedAppState;
  conflicts: ImportConflict[];
  changes: {
    settings: number;
    customItems: number;
    wordItems: number;
    stats: number;
  };
}

export const createEmptyDirectionStats = (): DirectionStats => ({
  streak: 0,
  reviews: 0,
  recentResults: [],
  ease: DEFAULT_EASE,
  intervalDays: 0,
  lastReviewedAt: null,
  dueAt: 0,
});

const normalizeStats = (storedStats: unknown): StatsMap => {
  if (!storedStats || typeof storedStats !== 'object' || Array.isArray(storedStats)) {
    return {};
  }

  return Object.entries(storedStats as Record<string, unknown>).reduce<StatsMap>((acc, [id, itemStats]) => {
    if (!itemStats || typeof itemStats !== 'object' || Array.isArray(itemStats)) {
      return acc;
    }

    const normalizedDirections = (['k2r', 'r2k'] as Direction[]).reduce<CardStats>((directions, direction) => {
      const directionStats = (itemStats as Record<string, unknown>)[direction];
      if (!directionStats || typeof directionStats !== 'object' || Array.isArray(directionStats)) {
        return directions;
      }

      const safeDirectionStats = directionStats as Partial<DirectionStats> & Record<string, unknown>;
      const gotIt = typeof safeDirectionStats.gotIt === 'number' && Number.isFinite(safeDirectionStats.gotIt)
        ? safeDirectionStats.gotIt
        : undefined;
      const missed = typeof safeDirectionStats.missed === 'number' && Number.isFinite(safeDirectionStats.missed)
        ? safeDirectionStats.missed
        : undefined;
      const streak = typeof safeDirectionStats.streak === 'number' && Number.isFinite(safeDirectionStats.streak)
        ? safeDirectionStats.streak
        : 0;
      const reviews = typeof safeDirectionStats.reviews === 'number' && Number.isFinite(safeDirectionStats.reviews)
        ? safeDirectionStats.reviews
        : 0;
      const ease = typeof safeDirectionStats.ease === 'number' && Number.isFinite(safeDirectionStats.ease)
        ? Math.max(MIN_EASE, safeDirectionStats.ease)
        : DEFAULT_EASE;
      const intervalDays = typeof safeDirectionStats.intervalDays === 'number' && Number.isFinite(safeDirectionStats.intervalDays)
        ? Math.max(0, safeDirectionStats.intervalDays)
        : 0;
      const lastReviewedAt = typeof safeDirectionStats.lastReviewedAt === 'number' && Number.isFinite(safeDirectionStats.lastReviewedAt)
        ? safeDirectionStats.lastReviewedAt
        : null;
      const dueAt = typeof safeDirectionStats.dueAt === 'number' && Number.isFinite(safeDirectionStats.dueAt)
        ? safeDirectionStats.dueAt
        : (lastReviewedAt !== null ? lastReviewedAt + intervalDays * DAY_IN_MS : 0);

      directions[direction] = {
        ...(typeof gotIt === 'number' ? { gotIt } : {}),
        ...(typeof missed === 'number' ? { missed } : {}),
        streak,
        reviews,
        recentResults: Array.isArray(safeDirectionStats.recentResults)
          ? safeDirectionStats.recentResults.filter((value): value is 0 | 1 => value === 1 || value === 0).slice(-RECENT_RESULTS_LIMIT)
          : [],
        ease,
        intervalDays,
        lastReviewedAt,
        dueAt,
      };

      return directions;
    }, {});

    if (Object.keys(normalizedDirections).length > 0) {
      acc[id] = normalizedDirections;
    }

    return acc;
  }, {});
};

export const loadStoredStats = (): StatsMap => {
  if (typeof window === 'undefined') return {};

  try {
    const storedValue = window.localStorage.getItem(STATS_STORAGE_KEY);
    if (!storedValue) return {};
    return normalizeStats(JSON.parse(storedValue));
  } catch {
    return {};
  }
};

const loadStoredSoundEnabled = (): boolean => {
  if (typeof window === 'undefined') return true;

  try {
    const storedValue = window.localStorage.getItem(SOUND_SETTINGS_KEY);
    return storedValue === null ? true : storedValue === 'true';
  } catch {
    return true;
  }
};

const loadStoredHapticsEnabled = (): boolean => {
  if (typeof window === 'undefined') return true;

  try {
    const storedValue = window.localStorage.getItem(HAPTICS_SETTINGS_KEY);
    return storedValue === null ? true : storedValue === 'true';
  } catch {
    return true;
  }
};

export const buildLocalStorageExport = (): string => {
  if (typeof window === 'undefined') {
    return '{}';
  }

  return JSON.stringify(buildStorageSnapshot(window.localStorage), null, 2);
};

const tryParseJson = (value: string | null | undefined): unknown => {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const loadStoredStudyMode = (): StudyMode => {
  if (typeof window === 'undefined') return 'characters';

  try {
    const storedValue = window.localStorage.getItem(STUDY_MODE_STORAGE_KEY);
    return storedValue === 'words' ? 'words' : 'characters';
  } catch {
    return 'characters';
  }
};

const normalizeStoredSettings = (storedSettings: unknown): Partial<SettingsState> => {
  if (!storedSettings || typeof storedSettings !== 'object' || Array.isArray(storedSettings)) {
    return {};
  }

  const safeSettings = storedSettings as Partial<SettingsState> & Record<string, unknown>;

  return {
    ...(safeSettings.studyMode === 'words' || safeSettings.studyMode === 'characters' ? { studyMode: safeSettings.studyMode } : {}),
    ...(typeof safeSettings.hiragana === 'boolean' ? { hiragana: safeSettings.hiragana } : {}),
    ...(typeof safeSettings.katakana === 'boolean' ? { katakana: safeSettings.katakana } : {}),
    ...(typeof safeSettings.kanji === 'boolean' ? { kanji: safeSettings.kanji } : {}),
    ...(typeof safeSettings.jlptN5Kanji === 'boolean' ? { jlptN5Kanji: safeSettings.jlptN5Kanji } : {}),
    ...(typeof safeSettings.showOnyomi === 'boolean' ? { showOnyomi: safeSettings.showOnyomi } : {}),
    ...(typeof safeSettings.showKunyomi === 'boolean' ? { showKunyomi: safeSettings.showKunyomi } : {}),
    ...(typeof safeSettings.dakuten === 'boolean' ? { dakuten: safeSettings.dakuten } : {}),
    ...(typeof safeSettings.handakuten === 'boolean' ? { handakuten: safeSettings.handakuten } : {}),
    ...(typeof safeSettings.yoon === 'boolean' ? { yoon: safeSettings.yoon } : {}),
    ...(typeof safeSettings.experimentalDeckBuilderEnabled === 'boolean'
      ? { experimentalDeckBuilderEnabled: safeSettings.experimentalDeckBuilderEnabled }
      : {}),
    ...(typeof safeSettings.soundEnabled === 'boolean' ? { soundEnabled: safeSettings.soundEnabled } : {}),
    ...(typeof safeSettings.hapticsEnabled === 'boolean' ? { hapticsEnabled: safeSettings.hapticsEnabled } : {}),
  };
};

const loadSettingsFromSnapshot = (snapshot: Partial<Record<DebugExportKey, string | null>>): SettingsState => {
  const storedSettingsValue = snapshot[SETTINGS_STORAGE_KEY];
  const storedSoundValue = snapshot[SOUND_SETTINGS_KEY];
  const storedHapticsValue = snapshot[HAPTICS_SETTINGS_KEY];

  if (typeof storedSettingsValue === 'string') {
    return {
      ...DEFAULT_SETTINGS,
      ...normalizeStoredSettings(tryParseJson(storedSettingsValue)),
    };
  }

  return {
    ...DEFAULT_SETTINGS,
    studyMode: snapshot[STUDY_MODE_STORAGE_KEY] === 'words' ? 'words' : 'characters',
    soundEnabled: storedSoundValue == null ? DEFAULT_SETTINGS.soundEnabled : storedSoundValue === 'true',
    hapticsEnabled: storedHapticsValue == null ? DEFAULT_SETTINGS.hapticsEnabled : storedHapticsValue === 'true',
  };
};

export const loadStoredSettings = (): SettingsState => {
  if (typeof window === 'undefined') {
    return DEFAULT_SETTINGS;
  }

  try {
    const storedSettingsValue = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (storedSettingsValue) {
      return {
        ...DEFAULT_SETTINGS,
        ...normalizeStoredSettings(JSON.parse(storedSettingsValue)),
      };
    }
  } catch {
    // Fall back to legacy per-setting keys below.
  }

  return {
    ...DEFAULT_SETTINGS,
    studyMode: loadStoredStudyMode(),
    soundEnabled: loadStoredSoundEnabled(),
    hapticsEnabled: loadStoredHapticsEnabled(),
  };
};

export const normalizeStoredCardItems = (
  storedItems: unknown,
  fallbackItems: CardItem[],
  studyMode: StudyMode,
  fallbackType: CardType,
): CardItem[] => {
  if (!Array.isArray(storedItems)) {
    return fallbackItems;
  }

  const fallbackItemsById = new Map(fallbackItems.map(item => [item.id, item] as const));

  const normalizedItems = storedItems.reduce<CardItem[]>((acc, item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return acc;
    }

    const safeItem = item as Partial<CardItem> & Record<string, unknown>;
    const char = typeof safeItem.char === 'string' ? safeItem.char.trim() : '';
    const romaji = typeof safeItem.romaji === 'string' ? safeItem.romaji.trim().toLowerCase() : '';
    if (!char || !romaji) {
      return acc;
    }

    const itemId = typeof safeItem.id === 'string' && safeItem.id.trim() ? safeItem.id : `${studyMode}_${Date.now()}_${index}`;
    const fallbackItem = fallbackItemsById.get(itemId);

    const itemType = safeItem.type === 'hiragana' || safeItem.type === 'katakana' || safeItem.type === 'kanji' || safeItem.type === 'word'
      ? safeItem.type
      : fallbackType;

    const meanings = Array.isArray(safeItem.meanings)
      ? safeItem.meanings.filter((meaning): meaning is string => typeof meaning === 'string' && meaning.trim().length > 0).map(meaning => meaning.trim())
      : [];

    const frequency = typeof safeItem.frequency === 'number' && Number.isFinite(safeItem.frequency)
      ? safeItem.frequency
      : (typeof fallbackItem?.frequency === 'number' && Number.isFinite(fallbackItem.frequency) ? fallbackItem.frequency : undefined);

    acc.push({
      id: itemId,
      char,
      romaji,
      type: itemType,
      studyMode,
      meanings: studyMode === 'words' ? meanings : undefined,
      ...(typeof frequency === 'number' ? { frequency } : {}),
    });

    return acc;
  }, []);

  return normalizedItems.length > 0 ? normalizedItems : fallbackItems;
};

const isStorageSnapshotLike = (payload: unknown): payload is Partial<Record<DebugExportKey, string | null>> => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }

  return [
    STATS_STORAGE_KEY,
    CUSTOM_ITEMS_STORAGE_KEY,
    WORD_ITEMS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    STUDY_MODE_STORAGE_KEY,
    SOUND_SETTINGS_KEY,
    HAPTICS_SETTINGS_KEY,
  ].some(key => key in payload);
};

const extractStorageSnapshot = (payload: unknown): Partial<Record<DebugExportKey, string | null>> | null => {
  if (isStorageSnapshotLike(payload)) {
    return payload;
  }

  if (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && 'data' in payload
    && isStorageSnapshotLike((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: Partial<Record<DebugExportKey, string | null>> }).data;
  }

  return null;
};

const cloneDirectionStats = (directionStats: DirectionStats): DirectionStats => ({
  ...directionStats,
  recentResults: [...directionStats.recentResults],
});

const cloneStatsMap = (stats: StatsMap): StatsMap => (
  Object.entries(stats).reduce<StatsMap>((acc, [cardId, cardStats]) => {
    const nextCardStats: CardStats = {};

    (['k2r', 'r2k'] as Direction[]).forEach(direction => {
      const directionStats = cardStats[direction];
      if (directionStats) {
        nextCardStats[direction] = cloneDirectionStats(directionStats);
      }
    });

    if (Object.keys(nextCardStats).length > 0) {
      acc[cardId] = nextCardStats;
    }

    return acc;
  }, {})
);

const areStringArraysEqual = (left: string[] = [], right: string[] = []): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

const areNumberTupleRangesEqual = (
  left?: [number, number],
  right?: [number, number],
): boolean => (
  left === right
  || (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === 2
    && right.length === 2
    && left[0] === right[0]
    && left[1] === right[1]
  )
);

const areCardItemsEqual = (left: CardItem, right: CardItem, studyMode: StudyMode): boolean => (
  left.id === right.id
  && left.char === right.char
  && left.romaji === right.romaji
  && left.type === right.type
  && (left.studyMode ?? studyMode) === (right.studyMode ?? studyMode)
  && areStringArraysEqual(left.meanings ?? [], right.meanings ?? [])
  && (left.frequency ?? null) === (right.frequency ?? null)
  && (left.readingType ?? null) === (right.readingType ?? null)
  && areNumberTupleRangesEqual(left.readingRange, right.readingRange)
);

const areDirectionStatsEqual = (left: DirectionStats, right: DirectionStats): boolean => (
  (left.gotIt ?? null) === (right.gotIt ?? null)
  && (left.missed ?? null) === (right.missed ?? null)
  && left.streak === right.streak
  && left.reviews === right.reviews
  && left.ease === right.ease
  && left.intervalDays === right.intervalDays
  && left.lastReviewedAt === right.lastReviewedAt
  && left.dueAt === right.dueAt
  && left.recentResults.length === right.recentResults.length
  && left.recentResults.every((value, index) => value === right.recentResults[index])
);

export const parseStorageImport = (fileContents: string): ImportedAppState | null => {
  try {
    const parsedPayload = JSON.parse(fileContents);
    const snapshot = extractStorageSnapshot(parsedPayload);

    if (!snapshot) {
      return null;
    }

    return {
      settings: loadSettingsFromSnapshot(snapshot),
      stats: normalizeStats(tryParseJson(snapshot[STATS_STORAGE_KEY])),
      customItems: normalizeStoredCardItems(tryParseJson(snapshot[CUSTOM_ITEMS_STORAGE_KEY]), [], 'characters', 'kanji'),
      wordItems: normalizeStoredCardItems(tryParseJson(snapshot[WORD_ITEMS_STORAGE_KEY]), [], 'words', 'word'),
    };
  } catch {
    return null;
  }
};

export const buildStorageImportPlan = (
  currentState: ImportedAppState,
  importedState: ImportedAppState,
): StorageImportPlan => {
  const conflicts: ImportConflict[] = [];
  const mergedState: ImportedAppState = {
    settings: { ...currentState.settings },
    stats: cloneStatsMap(currentState.stats),
    customItems: [...currentState.customItems],
    wordItems: [...currentState.wordItems],
  };
  const changes = {
    settings: 0,
    customItems: 0,
    wordItems: 0,
    stats: 0,
  };

  SETTINGS_FIELDS.forEach(field => {
    if (currentState.settings[field] === importedState.settings[field]) {
      return;
    }

    changes.settings += 1;
    conflicts.push({
      id: `settings:${field}`,
      kind: 'settings',
      field,
      localValue: currentState.settings[field],
      importedValue: importedState.settings[field],
    });
  });

  const mergeItems = (
    localItems: CardItem[],
    importedItems: CardItem[],
    targetItems: CardItem[],
    studyMode: StudyMode,
    kind: 'customItem' | 'wordItem',
  ): number => {
    const localItemsById = new Map(localItems.map(item => [item.id, item] as const));
    let mergedCount = 0;

    importedItems.forEach(importedItem => {
      const localItem = localItemsById.get(importedItem.id);

      if (!localItem) {
        targetItems.push(importedItem);
        mergedCount += 1;
        return;
      }

      if (areCardItemsEqual(localItem, importedItem, studyMode)) {
        return;
      }

      conflicts.push({
        id: `${kind}:${importedItem.id}`,
        kind,
        itemId: importedItem.id,
        localValue: localItem,
        importedValue: importedItem,
      });
    });

    return mergedCount;
  };

  changes.customItems = mergeItems(
    currentState.customItems,
    importedState.customItems,
    mergedState.customItems,
    'characters',
    'customItem',
  );

  changes.wordItems = mergeItems(
    currentState.wordItems,
    importedState.wordItems,
    mergedState.wordItems,
    'words',
    'wordItem',
  );

  Object.entries(importedState.stats).forEach(([cardId, importedCardStats]) => {
    const localCardStats = mergedState.stats[cardId] ?? {};
    let hasChanges = Boolean(mergedState.stats[cardId]);

    (['k2r', 'r2k'] as Direction[]).forEach(direction => {
      const importedDirectionStats = importedCardStats[direction];
      if (!importedDirectionStats) {
        return;
      }

      const localDirectionStats = localCardStats[direction];
      if (!localDirectionStats) {
        localCardStats[direction] = cloneDirectionStats(importedDirectionStats);
        hasChanges = true;
        changes.stats += 1;
        return;
      }

      if (areDirectionStatsEqual(localDirectionStats, importedDirectionStats)) {
        return;
      }

      conflicts.push({
        id: `stats:${cardId}:${direction}`,
        kind: 'stats',
        cardId,
        direction,
        localValue: localDirectionStats,
        importedValue: importedDirectionStats,
      });
    });

    if (hasChanges) {
      mergedState.stats[cardId] = localCardStats;
    }
  });

  return {
    importedState,
    mergedState,
    conflicts,
    changes,
  };
};

export const resolveStorageImportPlan = (
  plan: StorageImportPlan,
  conflictChoices: Partial<Record<string, ImportConflictChoice>>,
): ImportedAppState => {
  const resolvedState: ImportedAppState = {
    settings: { ...plan.mergedState.settings },
    stats: cloneStatsMap(plan.mergedState.stats),
    customItems: [...plan.mergedState.customItems],
    wordItems: [...plan.mergedState.wordItems],
  };

  plan.conflicts.forEach(conflict => {
    if (conflictChoices[conflict.id] !== 'imported') {
      return;
    }

    switch (conflict.kind) {
      case 'settings':
        resolvedState.settings = {
          ...resolvedState.settings,
          [conflict.field]: conflict.importedValue,
        } as SettingsState;
        return;
      case 'customItem': {
        const nextItems = resolvedState.customItems.map(item => (
          item.id === conflict.itemId ? conflict.importedValue : item
        ));
        resolvedState.customItems = nextItems;
        return;
      }
      case 'wordItem': {
        const nextItems = resolvedState.wordItems.map(item => (
          item.id === conflict.itemId ? conflict.importedValue : item
        ));
        resolvedState.wordItems = nextItems;
        return;
      }
      case 'stats': {
        const existingCardStats = resolvedState.stats[conflict.cardId] ?? {};
        resolvedState.stats[conflict.cardId] = {
          ...existingCardStats,
          [conflict.direction]: cloneDirectionStats(conflict.importedValue),
        };
        return;
      }
      default:
        return;
    }
  });

  return resolvedState;
};

export const loadStoredCardItems = (
  storageKey: string,
  fallbackItems: CardItem[],
  studyMode: StudyMode,
  fallbackType: CardType,
): CardItem[] => {
  if (typeof window === 'undefined') return fallbackItems;

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) return fallbackItems;
    return normalizeStoredCardItems(JSON.parse(storedValue), fallbackItems, studyMode, fallbackType);
  } catch {
    return fallbackItems;
  }
};
