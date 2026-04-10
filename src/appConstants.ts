import type { SettingsState } from './types';

export const DAY_IN_MS = 24 * 60 * 60 * 1000;
export const MIN_EASE = 1.3;
export const DEFAULT_EASE = 2.5;
export const RECENT_RESULTS_LIMIT = 10;
export const MIN_RECENT_REVIEWS_FOR_STRONG = 5;

export const DEFAULT_SETTINGS: SettingsState = {
  studyMode: 'characters',
  hiragana: true,
  katakana: true,
  kanji: true,
  jlptN5Kanji: true,
  dakuten: true,
  handakuten: true,
  yoon: true,
  experimentalDeckBuilderEnabled: true,
  soundEnabled: true,
  hapticsEnabled: true,
};
