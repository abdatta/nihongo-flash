import type { ComponentType, Dispatch, MutableRefObject, SetStateAction } from 'react';

export type CardType = 'hiragana' | 'katakana' | 'kanji';
export type Direction = 'k2r' | 'r2k';
export type ReviewResult = 'gotIt' | 'missed';
export type FeedbackEffect = 'reveal' | ReviewResult;
export type StrengthBucket = 'new' | 'weak' | 'strong' | 'improving';

export interface CardItem {
  id: string;
  char: string;
  romaji: string;
  type: CardType;
}

export interface DirectionStats {
  gotIt: number;
  missed: number;
  streak: number;
  reviews: number;
  recentResults: number[];
  ease: number;
  intervalDays: number;
  lastReviewedAt: number | null;
  dueAt: number;
}

export type CardStats = Partial<Record<Direction, DirectionStats>>;
export type StatsMap = Record<string, CardStats>;

export interface SettingsState {
  hiragana: boolean;
  katakana: boolean;
  kanji: boolean;
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
  direction: Direction;
  stats: StatsMap;
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
  hapticsSupported: boolean;
}

export type SettingsViewComponent = ComponentType<SettingsViewProps>;

export interface StatsViewProps {
  stats: StatsMap;
  allItems: CardItem[];
}

export type StatsViewComponent = ComponentType<StatsViewProps>;

export interface DrawingPadProps {
  onClearRef?: MutableRefObject<(() => void) | null> | null;
  disabled?: boolean;
  onDrawStateChange?: (hasDrawn: boolean) => void;
}
