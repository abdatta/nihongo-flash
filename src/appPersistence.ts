import {
  buildStorageSnapshot,
  HAPTICS_SETTINGS_KEY,
  SETTINGS_STORAGE_KEY,
  SOUND_SETTINGS_KEY,
  STATS_STORAGE_KEY,
  STUDY_MODE_STORAGE_KEY,
} from './storageKeys';
import { DAY_IN_MS, DEFAULT_EASE, DEFAULT_SETTINGS, MIN_EASE, RECENT_RESULTS_LIMIT } from './appConstants';
import type { CardItem, CardStats, CardType, Direction, DirectionStats, SettingsState, StudyMode, StatsMap } from './types';

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

const normalizeStoredCardItems = (
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
