export const STATS_STORAGE_KEY = 'nihongo-flash:stats';
export const CUSTOM_ITEMS_STORAGE_KEY = 'nihongo-flash:custom-items';
export const WORD_ITEMS_STORAGE_KEY = 'nihongo-flash:word-items';
export const SETTINGS_STORAGE_KEY = 'nihongo-flash:settings';
export const STUDY_MODE_STORAGE_KEY = 'nihongo-flash:study-mode';
export const SOUND_SETTINGS_KEY = 'nihongo-flash:sound-enabled';
export const HAPTICS_SETTINGS_KEY = 'nihongo-flash:haptics-enabled';

export const LOCAL_STORAGE_KEYS = [
  STATS_STORAGE_KEY,
  CUSTOM_ITEMS_STORAGE_KEY,
  WORD_ITEMS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  STUDY_MODE_STORAGE_KEY,
  SOUND_SETTINGS_KEY,
  HAPTICS_SETTINGS_KEY,
] as const;

export const DEBUG_EXPORT_KEYS = LOCAL_STORAGE_KEYS;

export type DebugExportKey = typeof LOCAL_STORAGE_KEYS[number];

export const buildStorageSnapshot = (storage: Storage): Record<DebugExportKey, string | null> => (
  LOCAL_STORAGE_KEYS.reduce<Record<DebugExportKey, string | null>>((acc, key) => {
    acc[key] = storage.getItem(key);
    return acc;
  }, {} as Record<DebugExportKey, string | null>)
);

export const applyStorageSnapshot = (
  storage: Storage,
  payload: unknown,
): void => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return;
  }

  for (const key of LOCAL_STORAGE_KEYS) {
    const value = (payload as Record<string, unknown>)[key];

    if (typeof value === 'string') {
      storage.setItem(key, value);
    } else if (value === null) {
      storage.removeItem(key);
    }
  }
};
