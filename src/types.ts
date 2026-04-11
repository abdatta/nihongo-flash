import type { ComponentType, Dispatch, MutableRefObject, SetStateAction } from 'react';

export type CardType = 'hiragana' | 'katakana' | 'kanji' | 'word';
export type StudyMode = 'characters' | 'words';
export type Direction = 'k2r' | 'r2k';
export type ReviewResult = 'gotIt' | 'missed';
export type FeedbackEffect = 'reveal' | ReviewResult;
export type StrengthBucket = 'new' | 'weak' | 'strong' | 'improving';
export type KanjiReadingType = 'onyomi' | 'kunyomi';

export interface CardItem {
  id: string;
  char: string;
  romaji: string;
  type: CardType;
  studyMode?: StudyMode;
  meanings?: string[];
  frequency?: number;
  // Kanji cards can mark which part of the displayed romaji belongs to the kanji itself.
  // The range is [start, end), so it can represent readings at the start, middle, or end.
  readingType?: KanjiReadingType;
  readingRange?: [number, number];
}

export interface DirectionStats {
  gotIt?: number;
  missed?: number;
  streak: number;
  reviews: number;
  recentResults: Array<0 | 1>;
  ease: number;
  intervalDays: number;
  lastReviewedAt: number | null;
  dueAt: number;
}

export type CardStats = Partial<Record<Direction, DirectionStats>>;
export type StatsMap = Record<string, CardStats>;

export interface SettingsState {
  studyMode: StudyMode;
  hiragana: boolean;
  katakana: boolean;
  kanji: boolean;
  jlptN5Kanji: boolean;
  dakuten: boolean;
  handakuten: boolean;
  yoon: boolean;
  experimentalDeckBuilderEnabled: boolean;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

export interface StrengthMeta {
  bucket: StrengthBucket;
  label: string;
  classes: string;
  usesRecentWindow: boolean;
  accuracy: number;
}

export interface PracticeSessionProps {
  activePool: CardItem[];
  studyMode: StudyMode;
  direction: Direction;
  stats: StatsMap;
  experimentalDeckBuilderEnabled: boolean;
  onUpdateStats: (id: string, result: ReviewResult, direction: Direction) => void;
  onPlaySound?: (effectName: FeedbackEffect) => void;
  onTriggerHaptics?: (effectName: FeedbackEffect) => void;
}

export type PracticeSessionComponentProps = Omit<PracticeSessionProps, 'direction'>;
export type PracticeSessionComponent = ComponentType<PracticeSessionProps>;

export interface SettingsViewProps {
  settings: SettingsState;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  customItems: CardItem[];
  setCustomItems: Dispatch<SetStateAction<CardItem[]>>;
  wordItems: CardItem[];
  setWordItems: Dispatch<SetStateAction<CardItem[]>>;
  hapticsSupported: boolean;
}

export type SettingsViewComponent = ComponentType<SettingsViewProps>;

export interface StatsViewProps {
  stats: StatsMap;
  allItems: CardItem[];
  activePool: CardItem[];
  studyMode: StudyMode;
  onResetStatCategory: (cardIds: string[], direction: Direction) => void;
  onResetStatItem: (cardIds: string[], direction: Direction) => void;
}

export type StatsViewComponent = ComponentType<StatsViewProps>;

export interface DrawingPadProps {
  onClearRef?: MutableRefObject<(() => void) | null> | null;
  disabled?: boolean;
  onDrawStateChange?: (hasDrawn: boolean) => void;
}
