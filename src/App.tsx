import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Settings, BarChart2, Edit3, BookOpen, Check, X, RefreshCw, Plus, Trash2, ArrowRight } from 'lucide-react';
import { toKana } from 'wanakana';
import RecognizePage from './pages/RecognizePage';
import RecallPage from './pages/RecallPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import type {
  CardItem,
  CardStats,
  CardType,
  Direction,
  DirectionStats,
  DrawingPadProps,
  FeedbackEffect,
  PracticeSessionComponentProps,
  PracticeSessionProps,
  ReviewResult,
  SettingsState,
  StudyMode,
  StatsMap,
  StatsViewProps,
  StrengthMeta,
} from './types';
import {
  buildStorageSnapshot,
  CUSTOM_ITEMS_STORAGE_KEY,
  HAPTICS_SETTINGS_KEY,
  SETTINGS_STORAGE_KEY,
  SOUND_SETTINGS_KEY,
  STATS_STORAGE_KEY,
  STUDY_MODE_STORAGE_KEY,
  WORD_ITEMS_STORAGE_KEY,
} from './storageKeys';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const RECENT_RESULTS_LIMIT = 10;
const MIN_RECENT_REVIEWS_FOR_STRONG = 5;

type PageId = 'recognize' | 'recall' | 'stats' | 'settings';
type DrawEvent = React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>;
type AudioConstructor = typeof AudioContext;

interface NoiseBurstOptions {
  start: number;
  duration: number;
  gain: number;
  filterType?: BiquadFilterType;
  frequency?: number;
  q?: number;
  playbackRate?: number;
}

interface ToneSweepOptions {
  start: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
  startFrequency: number;
  endFrequency: number;
  filterFrequency?: number;
}

interface AnalyzedStatItem extends CardItem, DirectionStats {
  ratio: number;
  usesRecentWindow: boolean;
  groupItems: CardItem[];
}

interface StatSectionProps {
  title: string;
  items: AnalyzedStatItem[];
  colorClass: string;
}

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface FlashcardProps {
  card: CardItem;
  direction: Direction;
  directionStats: DirectionStats;
  onAssess: (card: CardItem, result: ReviewResult) => void;
  onPlaySound?: (effectName: FeedbackEffect) => void;
  onTriggerHaptics?: (effectName: FeedbackEffect) => void;
}

const NOISE_BUFFER_CACHE = new WeakMap<BaseAudioContext, AudioBuffer>();

const NAV_PAGES = [
  { id: 'recognize', label: 'Recognize', icon: BookOpen, href: '#/recognize', title: 'Recognize' },
  { id: 'recall', label: 'Recall', icon: Edit3, href: '#/recall', title: 'Recall' },
  { id: 'stats', label: 'Stats', icon: BarChart2, href: '#/stats', title: 'Stats' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '#/settings', title: 'Settings' },
];

const normalizePageFromHash = (hash: string): PageId => {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : '';
  const route = normalizedHash.replace(/^#/, '') || '/';
  const pathname = route.startsWith('/') ? route : `/${route}`;

  switch (pathname) {
    case '/':
    case '/read':
    case '/recognize':
      return 'recognize';
    case '/write':
    case '/recall':
      return 'recall';
    case '/stats':
      return 'stats';
    case '/settings':
      return 'settings';
    default:
      return 'recognize';
  }
};

const getCanonicalHash = (hash: string): string | null => {
  const normalizedHash = typeof hash === 'string' ? hash.trim() : '';
  const route = normalizedHash.replace(/^#/, '') || '/';
  const pathname = route.startsWith('/') ? route : `/${route}`;

  switch (pathname) {
    case '/recognize':
      return '#/';
    case '/recall':
      return '#/write';
    default:
      return null;
  }
};

const useActivePage = (): PageId => {
  const [activePage, setActivePage] = useState<PageId>(() => {
    if (typeof window === 'undefined') return 'recognize';
    return normalizePageFromHash(window.location.hash);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncPage = () => {
      const canonicalHash = getCanonicalHash(window.location.hash);
      if (canonicalHash && window.location.hash !== canonicalHash) {
        window.location.replace(`${window.location.pathname}${window.location.search}${canonicalHash}`);
        return;
      }

      setActivePage(normalizePageFromHash(window.location.hash));
    };

    syncPage();
    window.addEventListener('hashchange', syncPage);

    return () => {
      window.removeEventListener('hashchange', syncPage);
    };
  }, []);

  return activePage;
};

const useViewportHeightVar = () => {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    let frameId: number | null = null;

    const syncViewportHeight = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      frameId = window.requestAnimationFrame(() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
        frameId = null;
      });
    };

    syncViewportHeight();

    const visualViewport = window.visualViewport;
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', syncViewportHeight);
    window.addEventListener('pageshow', syncViewportHeight);
    visualViewport?.addEventListener('resize', syncViewportHeight);
    visualViewport?.addEventListener('scroll', syncViewportHeight);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener('resize', syncViewportHeight);
      window.removeEventListener('orientationchange', syncViewportHeight);
      window.removeEventListener('pageshow', syncViewportHeight);
      visualViewport?.removeEventListener('resize', syncViewportHeight);
      visualViewport?.removeEventListener('scroll', syncViewportHeight);
    };
  }, []);
};

const createEmptyDirectionStats = (): DirectionStats => ({
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

const loadStoredStats = (): StatsMap => {
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

const buildLocalStorageExport = (): string => {
  if (typeof window === 'undefined') {
    return '{}';
  }

  return JSON.stringify(buildStorageSnapshot(window.localStorage), null, 2);
};

const getCardStudyMode = (card: CardItem): StudyMode => (
  card.studyMode ?? (card.type === 'word' ? 'words' : 'characters')
);

const getItemIdentityKey = (card: CardItem): string => `${getCardStudyMode(card)}::${card.char}::${card.romaji}`;

const formatDueLabel = (directionStats: DirectionStats): string => {
  if (directionStats.reviews === 0) {
    return 'Not introduced yet';
  }

  if (directionStats.dueAt <= Date.now()) {
    return 'Due now';
  }

  const hoursUntilDue = Math.max(1, Math.round((directionStats.dueAt - Date.now()) / (60 * 60 * 1000)));
  if (hoursUntilDue < 24) {
    return `Due in ${hoursUntilDue}h`;
  }

  const daysUntilDue = Math.max(1, Math.round(hoursUntilDue / 24));
  return `Due in ${daysUntilDue}d`;
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

const DEFAULT_SETTINGS: SettingsState = {
  studyMode: 'characters',
  hiragana: true,
  katakana: true,
  kanji: true,
  jlptN5Kanji: true,
  dakuten: true,
  handakuten: true,
  yoon: true,
  soundEnabled: true,
  hapticsEnabled: true,
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
    ...(typeof safeSettings.soundEnabled === 'boolean' ? { soundEnabled: safeSettings.soundEnabled } : {}),
    ...(typeof safeSettings.hapticsEnabled === 'boolean' ? { hapticsEnabled: safeSettings.hapticsEnabled } : {}),
  };
};

const loadStoredSettings = (): SettingsState => {
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

    const itemType = safeItem.type === 'hiragana' || safeItem.type === 'katakana' || safeItem.type === 'kanji' || safeItem.type === 'word'
      ? safeItem.type
      : fallbackType;

    const meanings = Array.isArray(safeItem.meanings)
      ? safeItem.meanings.filter((meaning): meaning is string => typeof meaning === 'string' && meaning.trim().length > 0).map(meaning => meaning.trim())
      : [];

    acc.push({
      id: typeof safeItem.id === 'string' && safeItem.id.trim() ? safeItem.id : `${studyMode}_${Date.now()}_${index}`,
      char,
      romaji,
      type: itemType,
      studyMode,
      meanings: studyMode === 'words' ? meanings : undefined,
    });

    return acc;
  }, []);

  return normalizedItems.length > 0 ? normalizedItems : fallbackItems;
};

const loadStoredCardItems = (
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

const HAPTIC_PATTERNS: Record<FeedbackEffect, number | number[]> = {
  reveal: 12,
  gotIt: [18, 24, 36],
  missed: [28, 36, 20],
};

const isLikelyHapticsSupported = (): boolean => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  return /Android/i.test(userAgent);
};

const getNoiseBuffer = (audioContext: AudioContext): AudioBuffer => {
  const cached = NOISE_BUFFER_CACHE.get(audioContext);
  if (cached) return cached;

  const bufferSize = audioContext.sampleRate;
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const channelData = noiseBuffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i += 1) {
    channelData[i] = Math.random() * 2 - 1;
  }

  NOISE_BUFFER_CACHE.set(audioContext, noiseBuffer);
  return noiseBuffer;
};

const playNoiseBurst = (
  audioContext: AudioContext,
  {
    start,
    duration,
    gain,
    filterType = 'bandpass',
    frequency = 900,
    q = 1,
    playbackRate = 1,
  }: NoiseBurstOptions,
): void => {
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const envelope = audioContext.createGain();
  const end = start + duration;

  source.buffer = getNoiseBuffer(audioContext);
  source.playbackRate.setValueAtTime(playbackRate, start);

  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, start);
  filter.Q.setValueAtTime(q, start);

  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.01, duration * 0.25));
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(audioContext.destination);

  source.start(start);
  source.stop(end + 0.02);
};

const playToneSweep = (
  audioContext: AudioContext,
  {
    start,
    duration,
    gain,
    type = 'triangle',
    startFrequency,
    endFrequency,
    filterFrequency = 1200,
  }: ToneSweepOptions,
): void => {
  const oscillator = audioContext.createOscillator();
  const filter = audioContext.createBiquadFilter();
  const envelope = audioContext.createGain();
  const end = start + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, end);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFrequency, start);
  filter.Q.setValueAtTime(0.8, start);

  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.015, duration * 0.35));
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(filter);
  filter.connect(envelope);
  envelope.connect(audioContext.destination);

  oscillator.start(start);
  oscillator.stop(end + 0.02);
};

const playSoundEffect = (audioContext: AudioContext | null, effectName: FeedbackEffect): void => {
  if (!audioContext) return;

  const startTime = audioContext.currentTime + 0.01;

  if (effectName === 'reveal') {
    playNoiseBurst(audioContext, {
      start: startTime,
      duration: 0.055,
      gain: 0.009,
      filterType: 'bandpass',
      frequency: 780,
      q: 1.1,
      playbackRate: 1.15,
    });
    playNoiseBurst(audioContext, {
      start: startTime + 0.03,
      duration: 0.045,
      gain: 0.008,
      filterType: 'bandpass',
      frequency: 1200,
      q: 1.6,
      playbackRate: 1.4,
    });
    playToneSweep(audioContext, {
      start: startTime,
      duration: 0.09,
      gain: 0.018,
      type: 'triangle',
      startFrequency: 240,
      endFrequency: 420,
      filterFrequency: 1400,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.018,
      duration: 0.11,
      gain: 0.02,
      type: 'sine',
      startFrequency: 420,
      endFrequency: 760,
      filterFrequency: 2400,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.06,
      duration: 0.075,
      gain: 0.013,
      type: 'triangle',
      startFrequency: 760,
      endFrequency: 1100,
      filterFrequency: 3200,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.095,
      duration: 0.08,
      gain: 0.011,
      type: 'sine',
      startFrequency: 900,
      endFrequency: 1380,
      filterFrequency: 4200,
    });
    return;
  }

  if (effectName === 'gotIt') {
    playNoiseBurst(audioContext, {
      start: startTime,
      duration: 0.035,
      gain: 0.014,
      filterType: 'bandpass',
      frequency: 1050,
      q: 1.8,
      playbackRate: 1.8,
    });
    playToneSweep(audioContext, {
      start: startTime,
      duration: 0.085,
      gain: 0.02,
      type: 'triangle',
      startFrequency: 320,
      endFrequency: 520,
      filterFrequency: 1900,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.03,
      duration: 0.14,
      gain: 0.023,
      type: 'sine',
      startFrequency: 520,
      endFrequency: 980,
      filterFrequency: 3200,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.075,
      duration: 0.17,
      gain: 0.02,
      type: 'triangle',
      startFrequency: 820,
      endFrequency: 1320,
      filterFrequency: 4200,
    });
    playNoiseBurst(audioContext, {
      start: startTime + 0.07,
      duration: 0.045,
      gain: 0.013,
      filterType: 'bandpass',
      frequency: 1900,
      q: 2.2,
      playbackRate: 2.1,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.12,
      duration: 0.12,
      gain: 0.017,
      type: 'sine',
      startFrequency: 980,
      endFrequency: 1240,
      filterFrequency: 4800,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.16,
      duration: 0.14,
      gain: 0.015,
      type: 'sine',
      startFrequency: 1180,
      endFrequency: 1680,
      filterFrequency: 5800,
    });
    playNoiseBurst(audioContext, {
      start: startTime + 0.145,
      duration: 0.04,
      gain: 0.009,
      filterType: 'bandpass',
      frequency: 2400,
      q: 2.6,
      playbackRate: 2.5,
    });
    return;
  }

  if (effectName === 'missed') {
    playNoiseBurst(audioContext, {
      start: startTime,
      duration: 0.06,
      gain: 0.015,
      filterType: 'bandpass',
      frequency: 620,
      q: 1.3,
      playbackRate: 0.92,
    });
    playToneSweep(audioContext, {
      start: startTime,
      duration: 0.14,
      gain: 0.026,
      type: 'sine',
      startFrequency: 420,
      endFrequency: 180,
      filterFrequency: 700,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.03,
      duration: 0.16,
      gain: 0.017,
      type: 'triangle',
      startFrequency: 310,
      endFrequency: 120,
      filterFrequency: 540,
    });
    playToneSweep(audioContext, {
      start: startTime + 0.085,
      duration: 0.18,
      gain: 0.014,
      type: 'sine',
      startFrequency: 180,
      endFrequency: 82,
      filterFrequency: 260,
    });
    playNoiseBurst(audioContext, {
      start: startTime + 0.05,
      duration: 0.05,
      gain: 0.012,
      filterType: 'lowpass',
      frequency: 260,
      q: 0.9,
      playbackRate: 0.72,
    });
    playNoiseBurst(audioContext, {
      start: startTime + 0.11,
      duration: 0.07,
      gain: 0.01,
      filterType: 'bandpass',
      frequency: 180,
      q: 0.8,
      playbackRate: 0.58,
    });
  }
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const hasLegacyAccuracyData = (directionStats: DirectionStats | null | undefined): boolean => (
  typeof directionStats?.gotIt === 'number' || typeof directionStats?.missed === 'number'
);

const getLifetimeAccuracy = (directionStats: DirectionStats): number => {
  const gotIt = directionStats.gotIt ?? 0;
  const missed = directionStats.missed ?? 0;
  const total = gotIt + missed;
  return total === 0 ? 0.5 : gotIt / total;
};

const getRecentAccuracy = (directionStats: DirectionStats): number => {
  const recentResults = directionStats?.recentResults ?? [];
  if (recentResults.length === 0) {
    return 0.5;
  }

  const gotItCount = recentResults.reduce<number>((total, value) => total + value, 0);
  return gotItCount / recentResults.length;
};

const hasRecentClassificationData = (directionStats: DirectionStats): boolean => (
  (directionStats?.recentResults?.length ?? 0) >= MIN_RECENT_REVIEWS_FOR_STRONG
);

const shouldUseRecentAccuracy = (directionStats: DirectionStats): boolean => (
  !hasLegacyAccuracyData(directionStats) || hasRecentClassificationData(directionStats)
);

const getEffectiveAccuracy = (directionStats: DirectionStats): number => (
  shouldUseRecentAccuracy(directionStats)
    ? getRecentAccuracy(directionStats)
    : getLifetimeAccuracy(directionStats)
);

const getPriorityAccuracy = (directionStats: DirectionStats): number => {
  if (!hasLegacyAccuracyData(directionStats) || hasRecentClassificationData(directionStats)) {
    return getRecentAccuracy(directionStats);
  }

  const recentCount = directionStats.recentResults.length;
  if (recentCount === 0) {
    return getLifetimeAccuracy(directionStats);
  }

  const recentWeight = clamp(recentCount / MIN_RECENT_REVIEWS_FOR_STRONG, 0.35, 0.85);
  const recentAccuracy = getRecentAccuracy(directionStats);
  const lifetimeAccuracy = getLifetimeAccuracy(directionStats);

  return (recentAccuracy * recentWeight) + (lifetimeAccuracy * (1 - recentWeight));
};

const getScheduledDirectionStats = (stats: StatsMap, cardId: string, direction: Direction): DirectionStats => {
  const existing = stats[cardId]?.[direction];
  return existing ? { ...createEmptyDirectionStats(), ...existing } : createEmptyDirectionStats();
};

const calculateNextDirectionStats = (
  currentDirectionStats: DirectionStats,
  result: ReviewResult,
  reviewedAt: number,
): DirectionStats => {
  const isGotIt = result === 'gotIt';
  const nextReviews = currentDirectionStats.reviews + 1;
  const nextRecentResults = [...currentDirectionStats.recentResults, isGotIt ? 1 : 0].slice(-RECENT_RESULTS_LIMIT) as Array<0 | 1>;
  const legacyGotIt = currentDirectionStats.gotIt ?? 0;
  const legacyMissed = currentDirectionStats.missed ?? 0;
  const shouldKeepLegacyAccuracy = hasLegacyAccuracyData(currentDirectionStats) && nextRecentResults.length < MIN_RECENT_REVIEWS_FOR_STRONG;
  const baseDirectionStats: DirectionStats = {
    streak: isGotIt ? currentDirectionStats.streak + 1 : -1,
    reviews: nextReviews,
    recentResults: nextRecentResults,
    ease: isGotIt ? clamp(currentDirectionStats.ease + 0.1, MIN_EASE, 3.0) : Math.max(MIN_EASE, currentDirectionStats.ease - 0.2),
    intervalDays: 0,
    lastReviewedAt: reviewedAt,
    dueAt: reviewedAt,
  };

  if (!isGotIt) {
    return {
      ...baseDirectionStats,
      ...(shouldKeepLegacyAccuracy ? { gotIt: legacyGotIt, missed: legacyMissed + 1 } : {}),
    };
  }

  let nextIntervalDays = 1;
  if (currentDirectionStats.reviews === 1) {
    nextIntervalDays = 3;
  } else if (currentDirectionStats.reviews >= 2) {
    nextIntervalDays = Math.max(4, Math.round(Math.max(1, currentDirectionStats.intervalDays) * currentDirectionStats.ease));
  }

  return {
    ...baseDirectionStats,
    intervalDays: nextIntervalDays,
    dueAt: reviewedAt + nextIntervalDays * DAY_IN_MS,
    ...(shouldKeepLegacyAccuracy ? { gotIt: legacyGotIt + 1, missed: legacyMissed } : {}),
  };
};

const getCardPriority = (card: CardItem, stats: StatsMap, direction: Direction, now: number) => {
  const directionStats = getScheduledDirectionStats(stats, card.id, direction);
  const accuracy = getPriorityAccuracy(directionStats);
  const isNew = directionStats.reviews === 0;
  const isDue = isNew || directionStats.dueAt <= now;
  const overdueDays = directionStats.dueAt ? Math.max(0, (now - directionStats.dueAt) / DAY_IN_MS) : 0;
  const upcomingDays = directionStats.dueAt > now ? (directionStats.dueAt - now) / DAY_IN_MS : 0;

  let score = 0;

  if (isDue) {
    score += 72;
  } else {
    score += Math.max(0, 42 - upcomingDays * 12);
  }

  score += overdueDays * 18;
  score += (1 - accuracy) * 72;
  score += directionStats.streak < 0 ? 18 : Math.max(0, 8 - directionStats.streak * 2);
  score += directionStats.reviews < 2 ? 14 : 0;
  score += isNew ? 22 : 0;
  score += accuracy < 0.6 ? 16 : 0;
  score -= accuracy > 0.85 && directionStats.streak >= 3 ? 10 : 0;
  score += Math.random() * 12;

  return { score, isDue, isNew, accuracy, directionStats };
};

const getCardStrengthMeta = (directionStats: DirectionStats | null | undefined): StrengthMeta => {
  if (!directionStats || directionStats.reviews === 0) {
    return {
      bucket: 'new',
      label: 'New',
      classes: 'bg-sky-500/15 text-sky-300 border border-sky-400/25',
      usesRecentWindow: false,
      accuracy: 0.5,
    };
  }

  const usesRecentWindow = shouldUseRecentAccuracy(directionStats);
  const accuracy = getEffectiveAccuracy(directionStats);

  if (accuracy < 0.6 || directionStats.streak < 0) {
    return {
      bucket: 'weak',
      label: 'Weak',
      classes: 'bg-rose-500/15 text-rose-300 border border-rose-400/25',
      usesRecentWindow,
      accuracy,
    };
  }

  if (
    accuracy > 0.8 &&
    directionStats.streak >= 3 &&
    hasRecentClassificationData(directionStats)
  ) {
    return {
      bucket: 'strong',
      label: 'Strong',
      classes: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/25',
      usesRecentWindow,
      accuracy,
    };
  }

  return {
    bucket: 'improving',
    label: 'Improving',
    classes: 'bg-amber-500/15 text-amber-300 border border-amber-400/25',
    usesRecentWindow,
    accuracy,
  };
};

const buildAdaptiveQueue = (
  activePool: CardItem[],
  stats: StatsMap,
  direction: Direction,
  sessionSize = 15,
): CardItem[] => {
  const now = Date.now();
  const rankedCards = activePool
    .map(card => ({ card, ...getCardPriority(card, stats, direction, now) }))
    .sort((a, b) => b.score - a.score);

  const reviewedEntries = rankedCards.filter(entry => !entry.isNew);
  const dueReviewedEntries = reviewedEntries.filter(entry => entry.isDue);
  const dueReviewedCount = dueReviewedEntries.length;
  const weakDueEntries = dueReviewedEntries.filter(entry => getCardStrengthMeta(entry.directionStats).bucket === 'weak');
  const dueNonStrongEntries = dueReviewedEntries.filter(entry => getCardStrengthMeta(entry.directionStats).bucket !== 'strong');
  const introducedCardCount = reviewedEntries.length;

  let targetNewCards = introducedCardCount < sessionSize ? 3 : 2;

  if (dueReviewedCount === 0) {
    targetNewCards = Math.min(2, introducedCardCount < sessionSize ? 3 : 2);
  } else if (weakDueEntries.length >= 6 || dueNonStrongEntries.length >= 8) {
    targetNewCards = 0;
  } else if (weakDueEntries.length >= 3 || dueNonStrongEntries.length >= 4) {
    targetNewCards = 1;
  } else if (weakDueEntries.length <= 1 && dueNonStrongEntries.length <= 1 && introducedCardCount < sessionSize) {
    targetNewCards = 3;
  } else {
    targetNewCards = 2;
  }

  const maxNewCards = introducedCardCount < sessionSize ? 3 : 2;
  const dueLearningEntries = dueReviewedEntries.filter(entry => getCardStrengthMeta(entry.directionStats).bucket !== 'strong');
  const dueStrongEntries = dueReviewedEntries.filter(entry => getCardStrengthMeta(entry.directionStats).bucket === 'strong');
  const futureLearningEntries = rankedCards.filter(entry => !entry.isDue && !entry.isNew && getCardStrengthMeta(entry.directionStats).bucket !== 'strong');
  const futureStrongEntries = rankedCards.filter(entry => !entry.isDue && !entry.isNew && getCardStrengthMeta(entry.directionStats).bucket === 'strong');
  const newEntries = rankedCards.filter(entry => entry.isNew);
  const prioritizedEntries = [
    ...dueLearningEntries,
    ...dueStrongEntries,
    ...newEntries,
    ...futureLearningEntries,
    ...futureStrongEntries,
  ];
  const selected: CardItem[] = [];
  const selectedIds = new Set();
  let newCardsSelected = 0;

  for (const entry of prioritizedEntries) {
    if (selected.length >= sessionSize) break;
    if (selectedIds.has(entry.card.id)) continue;
    if (entry.isNew && newCardsSelected >= targetNewCards) continue;

    selected.push(entry.card);
    selectedIds.add(entry.card.id);

    if (entry.isNew) {
      newCardsSelected += 1;
    }
  }

  if (selected.length < sessionSize) {
    for (const entry of prioritizedEntries) {
      if (selected.length >= sessionSize) break;
      if (selectedIds.has(entry.card.id)) continue;
      if (entry.isNew && newCardsSelected >= maxNewCards) continue;

      selected.push(entry.card);
      selectedIds.add(entry.card.id);

      if (entry.isNew) {
        newCardsSelected += 1;
      }
    }
  }

  return selected;
};

// --- DATA ---
const BASE_HIRAGANA: CardItem[] = [
  { id: 'h_a', char: 'あ', romaji: 'a', type: 'hiragana' }, { id: 'h_i', char: 'い', romaji: 'i', type: 'hiragana' }, { id: 'h_u', char: 'う', romaji: 'u', type: 'hiragana' }, { id: 'h_e', char: 'え', romaji: 'e', type: 'hiragana' }, { id: 'h_o', char: 'お', romaji: 'o', type: 'hiragana' },
  { id: 'h_ka', char: 'か', romaji: 'ka', type: 'hiragana' }, { id: 'h_ki', char: 'き', romaji: 'ki', type: 'hiragana' }, { id: 'h_ku', char: 'く', romaji: 'ku', type: 'hiragana' }, { id: 'h_ke', char: 'け', romaji: 'ke', type: 'hiragana' }, { id: 'h_ko', char: 'こ', romaji: 'ko', type: 'hiragana' },
  { id: 'h_sa', char: 'さ', romaji: 'sa', type: 'hiragana' }, { id: 'h_shi', char: 'し', romaji: 'shi', type: 'hiragana' }, { id: 'h_su', char: 'す', romaji: 'su', type: 'hiragana' }, { id: 'h_se', char: 'せ', romaji: 'se', type: 'hiragana' }, { id: 'h_so', char: 'そ', romaji: 'so', type: 'hiragana' },
  { id: 'h_ta', char: 'た', romaji: 'ta', type: 'hiragana' }, { id: 'h_chi', char: 'ち', romaji: 'chi', type: 'hiragana' }, { id: 'h_tsu', char: 'つ', romaji: 'tsu', type: 'hiragana' }, { id: 'h_te', char: 'て', romaji: 'te', type: 'hiragana' }, { id: 'h_to', char: 'と', romaji: 'to', type: 'hiragana' },
  { id: 'h_na', char: 'な', romaji: 'na', type: 'hiragana' }, { id: 'h_ni', char: 'に', romaji: 'ni', type: 'hiragana' }, { id: 'h_nu', char: 'ぬ', romaji: 'nu', type: 'hiragana' }, { id: 'h_ne', char: 'ね', romaji: 'ne', type: 'hiragana' }, { id: 'h_no', char: 'の', romaji: 'no', type: 'hiragana' },
  { id: 'h_ha', char: 'は', romaji: 'ha', type: 'hiragana' }, { id: 'h_hi', char: 'ひ', romaji: 'hi', type: 'hiragana' }, { id: 'h_fu', char: 'ふ', romaji: 'fu', type: 'hiragana' }, { id: 'h_he', char: 'へ', romaji: 'he', type: 'hiragana' }, { id: 'h_ho', char: 'ほ', romaji: 'ho', type: 'hiragana' },
  { id: 'h_ma', char: 'ま', romaji: 'ma', type: 'hiragana' }, { id: 'h_mi', char: 'み', romaji: 'mi', type: 'hiragana' }, { id: 'h_mu', char: 'む', romaji: 'mu', type: 'hiragana' }, { id: 'h_me', char: 'め', romaji: 'me', type: 'hiragana' }, { id: 'h_mo', char: 'も', romaji: 'mo', type: 'hiragana' },
  { id: 'h_ya', char: 'や', romaji: 'ya', type: 'hiragana' }, { id: 'h_yu', char: 'ゆ', romaji: 'yu', type: 'hiragana' }, { id: 'h_yo', char: 'よ', romaji: 'yo', type: 'hiragana' },
  { id: 'h_ra', char: 'ら', romaji: 'ra', type: 'hiragana' }, { id: 'h_ri', char: 'り', romaji: 'ri', type: 'hiragana' }, { id: 'h_ru', char: 'る', romaji: 'ru', type: 'hiragana' }, { id: 'h_re', char: 'れ', romaji: 're', type: 'hiragana' }, { id: 'h_ro', char: 'ろ', romaji: 'ro', type: 'hiragana' },
  { id: 'h_wa', char: 'わ', romaji: 'wa', type: 'hiragana' }, { id: 'h_wo', char: 'を', romaji: 'wo', type: 'hiragana' }, { id: 'h_n', char: 'ん', romaji: 'n', type: 'hiragana' }
];

const HIRAGANA_DAKUTEN: CardItem[] = [
  { id: 'h_ga', char: 'が', romaji: 'ga', type: 'hiragana' }, { id: 'h_gi', char: 'ぎ', romaji: 'gi', type: 'hiragana' }, { id: 'h_gu', char: 'ぐ', romaji: 'gu', type: 'hiragana' }, { id: 'h_ge', char: 'げ', romaji: 'ge', type: 'hiragana' }, { id: 'h_go', char: 'ご', romaji: 'go', type: 'hiragana' },
  { id: 'h_za', char: 'ざ', romaji: 'za', type: 'hiragana' }, { id: 'h_ji', char: 'じ', romaji: 'ji', type: 'hiragana' }, { id: 'h_zu', char: 'ず', romaji: 'zu', type: 'hiragana' }, { id: 'h_ze', char: 'ぜ', romaji: 'ze', type: 'hiragana' }, { id: 'h_zo', char: 'ぞ', romaji: 'zo', type: 'hiragana' },
  { id: 'h_da', char: 'だ', romaji: 'da', type: 'hiragana' }, { id: 'h_dji', char: 'ぢ', romaji: 'ji', type: 'hiragana' }, { id: 'h_dzu', char: 'づ', romaji: 'zu', type: 'hiragana' }, { id: 'h_de', char: 'で', romaji: 'de', type: 'hiragana' }, { id: 'h_do', char: 'ど', romaji: 'do', type: 'hiragana' },
  { id: 'h_ba', char: 'ば', romaji: 'ba', type: 'hiragana' }, { id: 'h_bi', char: 'び', romaji: 'bi', type: 'hiragana' }, { id: 'h_bu', char: 'ぶ', romaji: 'bu', type: 'hiragana' }, { id: 'h_be', char: 'べ', romaji: 'be', type: 'hiragana' }, { id: 'h_bo', char: 'ぼ', romaji: 'bo', type: 'hiragana' }
];

const HIRAGANA_HANDAKUTEN: CardItem[] = [
  { id: 'h_pa', char: 'ぱ', romaji: 'pa', type: 'hiragana' }, { id: 'h_pi', char: 'ぴ', romaji: 'pi', type: 'hiragana' }, { id: 'h_pu', char: 'ぷ', romaji: 'pu', type: 'hiragana' }, { id: 'h_pe', char: 'ぺ', romaji: 'pe', type: 'hiragana' }, { id: 'h_po', char: 'ぽ', romaji: 'po', type: 'hiragana' }
];

const HIRAGANA_YOON: CardItem[] = [
  { id: 'h_kya', char: 'きゃ', romaji: 'kya', type: 'hiragana' }, { id: 'h_kyu', char: 'きゅ', romaji: 'kyu', type: 'hiragana' }, { id: 'h_kyo', char: 'きょ', romaji: 'kyo', type: 'hiragana' },
  { id: 'h_gya', char: 'ぎゃ', romaji: 'gya', type: 'hiragana' }, { id: 'h_gyu', char: 'ぎゅ', romaji: 'gyu', type: 'hiragana' }, { id: 'h_gyo', char: 'ぎょ', romaji: 'gyo', type: 'hiragana' },
  { id: 'h_sha', char: 'しゃ', romaji: 'sha', type: 'hiragana' }, { id: 'h_shu', char: 'しゅ', romaji: 'shu', type: 'hiragana' }, { id: 'h_sho', char: 'しょ', romaji: 'sho', type: 'hiragana' },
  { id: 'h_ja', char: 'じゃ', romaji: 'ja', type: 'hiragana' }, { id: 'h_ju', char: 'じゅ', romaji: 'ju', type: 'hiragana' }, { id: 'h_jo', char: 'じょ', romaji: 'jo', type: 'hiragana' },
  { id: 'h_cha', char: 'ちゃ', romaji: 'cha', type: 'hiragana' }, { id: 'h_chu', char: 'ちゅ', romaji: 'chu', type: 'hiragana' }, { id: 'h_cho', char: 'ちょ', romaji: 'cho', type: 'hiragana' },
  { id: 'h_nya', char: 'にゃ', romaji: 'nya', type: 'hiragana' }, { id: 'h_nyu', char: 'にゅ', romaji: 'nyu', type: 'hiragana' }, { id: 'h_nyo', char: 'にょ', romaji: 'nyo', type: 'hiragana' },
  { id: 'h_hya', char: 'ひゃ', romaji: 'hya', type: 'hiragana' }, { id: 'h_hyu', char: 'ひゅ', romaji: 'hyu', type: 'hiragana' }, { id: 'h_hyo', char: 'ひょ', romaji: 'hyo', type: 'hiragana' },
  { id: 'h_bya', char: 'びゃ', romaji: 'bya', type: 'hiragana' }, { id: 'h_byu', char: 'びゅ', romaji: 'byu', type: 'hiragana' }, { id: 'h_byo', char: 'びょ', romaji: 'byo', type: 'hiragana' },
  { id: 'h_pya', char: 'ぴゃ', romaji: 'pya', type: 'hiragana' }, { id: 'h_pyu', char: 'ぴゅ', romaji: 'pyu', type: 'hiragana' }, { id: 'h_pyo', char: 'ぴょ', romaji: 'pyo', type: 'hiragana' },
  { id: 'h_mya', char: 'みゃ', romaji: 'mya', type: 'hiragana' }, { id: 'h_myu', char: 'みゅ', romaji: 'myu', type: 'hiragana' }, { id: 'h_myo', char: 'みょ', romaji: 'myo', type: 'hiragana' },
  { id: 'h_rya', char: 'りゃ', romaji: 'rya', type: 'hiragana' }, { id: 'h_ryu', char: 'りゅ', romaji: 'ryu', type: 'hiragana' }, { id: 'h_ryo', char: 'りょ', romaji: 'ryo', type: 'hiragana' }
];

const HIRAGANA: CardItem[] = [
  ...BASE_HIRAGANA,
  ...HIRAGANA_DAKUTEN,
  ...HIRAGANA_HANDAKUTEN,
  ...HIRAGANA_YOON,
];

const BASE_KATAKANA: CardItem[] = [
  { id: 'k_a', char: 'ア', romaji: 'a', type: 'katakana' }, { id: 'k_i', char: 'イ', romaji: 'i', type: 'katakana' }, { id: 'k_u', char: 'ウ', romaji: 'u', type: 'katakana' }, { id: 'k_e', char: 'エ', romaji: 'e', type: 'katakana' }, { id: 'k_o', char: 'オ', romaji: 'o', type: 'katakana' },
  { id: 'k_ka', char: 'カ', romaji: 'ka', type: 'katakana' }, { id: 'k_ki', char: 'キ', romaji: 'ki', type: 'katakana' }, { id: 'k_ku', char: 'ク', romaji: 'ku', type: 'katakana' }, { id: 'k_ke', char: 'ケ', romaji: 'ke', type: 'katakana' }, { id: 'k_ko', char: 'コ', romaji: 'ko', type: 'katakana' },
  { id: 'k_sa', char: 'サ', romaji: 'sa', type: 'katakana' }, { id: 'k_shi', char: 'シ', romaji: 'shi', type: 'katakana' }, { id: 'k_su', char: 'ス', romaji: 'su', type: 'katakana' }, { id: 'k_se', char: 'セ', romaji: 'se', type: 'katakana' }, { id: 'k_so', char: 'ソ', romaji: 'so', type: 'katakana' },
  { id: 'k_ta', char: 'タ', romaji: 'ta', type: 'katakana' }, { id: 'k_chi', char: 'チ', romaji: 'chi', type: 'katakana' }, { id: 'k_tsu', char: 'ツ', romaji: 'tsu', type: 'katakana' }, { id: 'k_te', char: 'テ', romaji: 'te', type: 'katakana' }, { id: 'k_to', char: 'ト', romaji: 'to', type: 'katakana' },
  { id: 'k_na', char: 'ナ', romaji: 'na', type: 'katakana' }, { id: 'k_ni', char: 'ニ', romaji: 'ni', type: 'katakana' }, { id: 'k_nu', char: 'ヌ', romaji: 'nu', type: 'katakana' }, { id: 'k_ne', char: 'ネ', romaji: 'ne', type: 'katakana' }, { id: 'k_no', char: 'ノ', romaji: 'no', type: 'katakana' },
  { id: 'k_ha', char: 'ハ', romaji: 'ha', type: 'katakana' }, { id: 'k_hi', char: 'ヒ', romaji: 'hi', type: 'katakana' }, { id: 'k_fu', char: 'フ', romaji: 'fu', type: 'katakana' }, { id: 'k_he', char: 'ヘ', romaji: 'he', type: 'katakana' }, { id: 'k_ho', char: 'ホ', romaji: 'ho', type: 'katakana' },
  { id: 'k_ma', char: 'マ', romaji: 'ma', type: 'katakana' }, { id: 'k_mi', char: 'ミ', romaji: 'mi', type: 'katakana' }, { id: 'k_mu', char: 'ム', romaji: 'mu', type: 'katakana' }, { id: 'k_me', char: 'メ', romaji: 'me', type: 'katakana' }, { id: 'k_mo', char: 'モ', romaji: 'mo', type: 'katakana' },
  { id: 'k_ya', char: 'ヤ', romaji: 'ya', type: 'katakana' }, { id: 'k_yu', char: 'ユ', romaji: 'yu', type: 'katakana' }, { id: 'k_yo', char: 'ヨ', romaji: 'yo', type: 'katakana' },
  { id: 'k_ra', char: 'ラ', romaji: 'ra', type: 'katakana' }, { id: 'k_ri', char: 'リ', romaji: 'ri', type: 'katakana' }, { id: 'k_ru', char: 'ル', romaji: 'ru', type: 'katakana' }, { id: 'k_re', char: 'レ', romaji: 're', type: 'katakana' }, { id: 'k_ro', char: 'ロ', romaji: 'ro', type: 'katakana' },
  { id: 'k_wa', char: 'ワ', romaji: 'wa', type: 'katakana' }, { id: 'k_wo', char: 'ヲ', romaji: 'wo', type: 'katakana' }, { id: 'k_n', char: 'ン', romaji: 'n', type: 'katakana' }
];

const KATAKANA_DAKUTEN: CardItem[] = [
  { id: 'k_ga', char: 'ガ', romaji: 'ga', type: 'katakana' }, { id: 'k_gi', char: 'ギ', romaji: 'gi', type: 'katakana' }, { id: 'k_gu', char: 'グ', romaji: 'gu', type: 'katakana' }, { id: 'k_ge', char: 'ゲ', romaji: 'ge', type: 'katakana' }, { id: 'k_go', char: 'ゴ', romaji: 'go', type: 'katakana' },
  { id: 'k_za', char: 'ザ', romaji: 'za', type: 'katakana' }, { id: 'k_ji', char: 'ジ', romaji: 'ji', type: 'katakana' }, { id: 'k_zu', char: 'ズ', romaji: 'zu', type: 'katakana' }, { id: 'k_ze', char: 'ゼ', romaji: 'ze', type: 'katakana' }, { id: 'k_zo', char: 'ゾ', romaji: 'zo', type: 'katakana' },
  { id: 'k_da', char: 'ダ', romaji: 'da', type: 'katakana' }, { id: 'k_dji', char: 'ヂ', romaji: 'ji', type: 'katakana' }, { id: 'k_dzu', char: 'ヅ', romaji: 'zu', type: 'katakana' }, { id: 'k_de', char: 'デ', romaji: 'de', type: 'katakana' }, { id: 'k_do', char: 'ド', romaji: 'do', type: 'katakana' },
  { id: 'k_ba', char: 'バ', romaji: 'ba', type: 'katakana' }, { id: 'k_bi', char: 'ビ', romaji: 'bi', type: 'katakana' }, { id: 'k_bu', char: 'ブ', romaji: 'bu', type: 'katakana' }, { id: 'k_be', char: 'ベ', romaji: 'be', type: 'katakana' }, { id: 'k_bo', char: 'ボ', romaji: 'bo', type: 'katakana' }
];

const KATAKANA_HANDAKUTEN: CardItem[] = [
  { id: 'k_pa', char: 'パ', romaji: 'pa', type: 'katakana' }, { id: 'k_pi', char: 'ピ', romaji: 'pi', type: 'katakana' }, { id: 'k_pu', char: 'プ', romaji: 'pu', type: 'katakana' }, { id: 'k_pe', char: 'ペ', romaji: 'pe', type: 'katakana' }, { id: 'k_po', char: 'ポ', romaji: 'po', type: 'katakana' }
];

const KATAKANA_YOON: CardItem[] = [
  { id: 'k_kya', char: 'キャ', romaji: 'kya', type: 'katakana' }, { id: 'k_kyu', char: 'キュ', romaji: 'kyu', type: 'katakana' }, { id: 'k_kyo', char: 'キョ', romaji: 'kyo', type: 'katakana' },
  { id: 'k_gya', char: 'ギャ', romaji: 'gya', type: 'katakana' }, { id: 'k_gyu', char: 'ギュ', romaji: 'gyu', type: 'katakana' }, { id: 'k_gyo', char: 'ギョ', romaji: 'gyo', type: 'katakana' },
  { id: 'k_sha', char: 'シャ', romaji: 'sha', type: 'katakana' }, { id: 'k_shu', char: 'シュ', romaji: 'shu', type: 'katakana' }, { id: 'k_sho', char: 'ショ', romaji: 'sho', type: 'katakana' },
  { id: 'k_ja', char: 'ジャ', romaji: 'ja', type: 'katakana' }, { id: 'k_ju', char: 'ジュ', romaji: 'ju', type: 'katakana' }, { id: 'k_jo', char: 'ジョ', romaji: 'jo', type: 'katakana' },
  { id: 'k_cha', char: 'チャ', romaji: 'cha', type: 'katakana' }, { id: 'k_chu', char: 'チュ', romaji: 'chu', type: 'katakana' }, { id: 'k_cho', char: 'チョ', romaji: 'cho', type: 'katakana' },
  { id: 'k_nya', char: 'ニャ', romaji: 'nya', type: 'katakana' }, { id: 'k_nyu', char: 'ニュ', romaji: 'nyu', type: 'katakana' }, { id: 'k_nyo', char: 'ニョ', romaji: 'nyo', type: 'katakana' },
  { id: 'k_hya', char: 'ヒャ', romaji: 'hya', type: 'katakana' }, { id: 'k_hyu', char: 'ヒュ', romaji: 'hyu', type: 'katakana' }, { id: 'k_hyo', char: 'ヒョ', romaji: 'hyo', type: 'katakana' },
  { id: 'k_bya', char: 'ビャ', romaji: 'bya', type: 'katakana' }, { id: 'k_byu', char: 'ビュ', romaji: 'byu', type: 'katakana' }, { id: 'k_byo', char: 'ビョ', romaji: 'byo', type: 'katakana' },
  { id: 'k_pya', char: 'ピャ', romaji: 'pya', type: 'katakana' }, { id: 'k_pyu', char: 'ピュ', romaji: 'pyu', type: 'katakana' }, { id: 'k_pyo', char: 'ピョ', romaji: 'pyo', type: 'katakana' },
  { id: 'k_mya', char: 'ミャ', romaji: 'mya', type: 'katakana' }, { id: 'k_myu', char: 'ミュ', romaji: 'myu', type: 'katakana' }, { id: 'k_myo', char: 'ミョ', romaji: 'myo', type: 'katakana' },
  { id: 'k_rya', char: 'リャ', romaji: 'rya', type: 'katakana' }, { id: 'k_ryu', char: 'リュ', romaji: 'ryu', type: 'katakana' }, { id: 'k_ryo', char: 'リョ', romaji: 'ryo', type: 'katakana' }
];

const KATAKANA: CardItem[] = [
  ...BASE_KATAKANA,
  ...KATAKANA_DAKUTEN,
  ...KATAKANA_HANDAKUTEN,
  ...KATAKANA_YOON,
];

const getEnabledHiraganaCards = (settings: SettingsState): CardItem[] => {
  const cards = [...BASE_HIRAGANA];

  if (settings.dakuten) {
    cards.push(...HIRAGANA_DAKUTEN);
  }

  if (settings.handakuten) {
    cards.push(...HIRAGANA_HANDAKUTEN);
  }

  if (settings.yoon) {
    cards.push(...HIRAGANA_YOON);
  }

  return cards;
};

const getEnabledKatakanaCards = (settings: SettingsState): CardItem[] => {
  const cards = [...BASE_KATAKANA];

  if (settings.dakuten) {
    cards.push(...KATAKANA_DAKUTEN);
  }

  if (settings.handakuten) {
    cards.push(...KATAKANA_HANDAKUTEN);
  }

  if (settings.yoon) {
    cards.push(...KATAKANA_YOON);
  }

  return cards;
};

const JLPT_N5_KANJI: CardItem[] = [
  { id: 'n5_ichi', char: '一', romaji: 'ichi', type: 'kanji', meanings: ['one'] },
  { id: 'n5_ni', char: '二', romaji: 'ni', type: 'kanji', meanings: ['two'] },
  { id: 'n5_san', char: '三', romaji: 'san', type: 'kanji', meanings: ['three'] },
  { id: 'n5_yon', char: '四', romaji: 'yon', type: 'kanji', meanings: ['four'] },
  { id: 'n5_go', char: '五', romaji: 'go', type: 'kanji', meanings: ['five'] },
  { id: 'n5_roku', char: '六', romaji: 'roku', type: 'kanji', meanings: ['six'] },
  { id: 'n5_nana', char: '七', romaji: 'nana', type: 'kanji', meanings: ['seven'] },
  { id: 'n5_hachi', char: '八', romaji: 'hachi', type: 'kanji', meanings: ['eight'] },
  { id: 'n5_kyuu', char: '九', romaji: 'kyuu', type: 'kanji', meanings: ['nine'] },
  { id: 'n5_juu', char: '十', romaji: 'juu', type: 'kanji', meanings: ['ten'] },
  { id: 'n5_hyaku', char: '百', romaji: 'hyaku', type: 'kanji', meanings: ['hundred'] },
  { id: 'n5_sen', char: '千', romaji: 'sen', type: 'kanji', meanings: ['thousand'] },
  { id: 'n5_man', char: '万', romaji: 'man', type: 'kanji', meanings: ['ten thousand'] },
  { id: 'n5_en', char: '円', romaji: 'en', type: 'kanji', meanings: ['yen', 'circle'] },
  { id: 'n5_hi_day', char: '日', romaji: 'hi', type: 'kanji', meanings: ['day', 'sun'] },
  { id: 'n5_tsuki', char: '月', romaji: 'tsuki', type: 'kanji', meanings: ['month', 'moon'] },
  { id: 'n5_hi_fire', char: '火', romaji: 'hi', type: 'kanji', meanings: ['fire'] },
  { id: 'n5_mizu', char: '水', romaji: 'mizu', type: 'kanji', meanings: ['water'] },
  { id: 'n5_ki', char: '木', romaji: 'ki', type: 'kanji', meanings: ['tree', 'wood'] },
  { id: 'n5_kane', char: '金', romaji: 'kane', type: 'kanji', meanings: ['money', 'gold'] },
  { id: 'n5_tsuchi', char: '土', romaji: 'tsuchi', type: 'kanji', meanings: ['earth', 'soil'] },
  { id: 'n5_hito', char: '人', romaji: 'hito', type: 'kanji', meanings: ['person'] },
  { id: 'n5_ko', char: '子', romaji: 'ko', type: 'kanji', meanings: ['child'] },
  { id: 'n5_onna', char: '女', romaji: 'onna', type: 'kanji', meanings: ['woman', 'female'] },
  { id: 'n5_otoko', char: '男', romaji: 'otoko', type: 'kanji', meanings: ['man', 'male'] },
  { id: 'n5_ue', char: '上', romaji: 'ue', type: 'kanji', meanings: ['up', 'above'] },
  { id: 'n5_shita', char: '下', romaji: 'shita', type: 'kanji', meanings: ['down', 'below'] },
  { id: 'n5_naka', char: '中', romaji: 'naka', type: 'kanji', meanings: ['middle', 'inside'] },
  { id: 'n5_ookii', char: '大', romaji: 'ookii', type: 'kanji', meanings: ['big', 'large'] },
  { id: 'n5_chiisai', char: '小', romaji: 'chiisai', type: 'kanji', meanings: ['small'] },
  { id: 'n5_hon', char: '本', romaji: 'hon', type: 'kanji', meanings: ['book', 'origin'] },
  { id: 'n5_han', char: '半', romaji: 'han', type: 'kanji', meanings: ['half'] },
  { id: 'n5_bun', char: '分', romaji: 'bun', type: 'kanji', meanings: ['part', 'minute'] },
  { id: 'n5_toki', char: '時', romaji: 'toki', type: 'kanji', meanings: ['time', 'hour'] },
  { id: 'n5_saki', char: '先', romaji: 'saki', type: 'kanji', meanings: ['ahead', 'previous'] },
  { id: 'n5_sei', char: '生', romaji: 'sei', type: 'kanji', meanings: ['life', 'birth', 'student'] },
  { id: 'n5_gaku', char: '学', romaji: 'gaku', type: 'kanji', meanings: ['study', 'learning'] },
  { id: 'n5_kou', char: '校', romaji: 'kou', type: 'kanji', meanings: ['school'] },
  { id: 'n5_go_language', char: '語', romaji: 'go', type: 'kanji', meanings: ['language', 'word'] },
  { id: 'n5_bun_text', char: '文', romaji: 'bun', type: 'kanji', meanings: ['sentence', 'writing'] },
  { id: 'n5_ji_letter', char: '字', romaji: 'ji', type: 'kanji', meanings: ['character', 'letter'] },
  { id: 'n5_na', char: '名', romaji: 'na', type: 'kanji', meanings: ['name'] },
  { id: 'n5_toshi', char: '年', romaji: 'toshi', type: 'kanji', meanings: ['year'] },
  { id: 'n5_shiro', char: '白', romaji: 'shiro', type: 'kanji', meanings: ['white'] },
  { id: 'n5_ame', char: '雨', romaji: 'ame', type: 'kanji', meanings: ['rain'] },
  { id: 'n5_den', char: '電', romaji: 'den', type: 'kanji', meanings: ['electricity'] },
  { id: 'n5_kuruma', char: '車', romaji: 'kuruma', type: 'kanji', meanings: ['car', 'vehicle'] },
  { id: 'n5_kiku', char: '聞', romaji: 'kiku', type: 'kanji', meanings: ['hear', 'listen', 'ask'] },
  { id: 'n5_taberu', char: '食', romaji: 'taberu', type: 'kanji', meanings: ['eat', 'food'] },
  { id: 'n5_nomu', char: '飲', romaji: 'nomu', type: 'kanji', meanings: ['drink'] },
  { id: 'n5_miru', char: '見', romaji: 'miru', type: 'kanji', meanings: ['see', 'look'] },
  { id: 'n5_iku', char: '行', romaji: 'iku', type: 'kanji', meanings: ['go'] },
  { id: 'n5_kuru', char: '来', romaji: 'kuru', type: 'kanji', meanings: ['come'] },
  { id: 'n5_kaeru', char: '帰', romaji: 'kaeru', type: 'kanji', meanings: ['return'] },
  { id: 'n5_yasumu', char: '休', romaji: 'yasumu', type: 'kanji', meanings: ['rest', 'holiday'] },
  { id: 'n5_tomo', char: '友', romaji: 'tomo', type: 'kanji', meanings: ['friend'] },
  { id: 'n5_aida', char: '間', romaji: 'aida', type: 'kanji', meanings: ['between', 'interval'] },
  { id: 'n5_chichi', char: '父', romaji: 'chichi', type: 'kanji', meanings: ['father'] },
  { id: 'n5_haha', char: '母', romaji: 'haha', type: 'kanji', meanings: ['mother'] },
  { id: 'n5_nani', char: '何', romaji: 'nani', type: 'kanji', meanings: ['what'] },
  { id: 'n5_mai', char: '毎', romaji: 'mai', type: 'kanji', meanings: ['every'] },
  { id: 'n5_ima', char: '今', romaji: 'ima', type: 'kanji', meanings: ['now'] },
  { id: 'n5_go_noon', char: '午', romaji: 'go', type: 'kanji', meanings: ['noon'] },
  { id: 'n5_ato', char: '後', romaji: 'ato', type: 'kanji', meanings: ['after', 'behind'] },
  { id: 'n5_mae', char: '前', romaji: 'mae', type: 'kanji', meanings: ['before', 'front'] },
  { id: 'n5_hidari', char: '左', romaji: 'hidari', type: 'kanji', meanings: ['left'] },
  { id: 'n5_migi', char: '右', romaji: 'migi', type: 'kanji', meanings: ['right'] },
  { id: 'n5_higashi', char: '東', romaji: 'higashi', type: 'kanji', meanings: ['east'] },
  { id: 'n5_nishi', char: '西', romaji: 'nishi', type: 'kanji', meanings: ['west'] },
  { id: 'n5_minami', char: '南', romaji: 'minami', type: 'kanji', meanings: ['south'] },
  { id: 'n5_kita', char: '北', romaji: 'kita', type: 'kanji', meanings: ['north'] },
  { id: 'n5_soto', char: '外', romaji: 'soto', type: 'kanji', meanings: ['outside'] },
  { id: 'n5_kuni', char: '国', romaji: 'kuni', type: 'kanji', meanings: ['country'] },
  { id: 'n5_yama', char: '山', romaji: 'yama', type: 'kanji', meanings: ['mountain'] },
  { id: 'n5_kawa', char: '川', romaji: 'kawa', type: 'kanji', meanings: ['river'] },
  { id: 'n5_ta', char: '田', romaji: 'ta', type: 'kanji', meanings: ['rice field'] },
  { id: 'n5_ten', char: '天', romaji: 'ten', type: 'kanji', meanings: ['heaven', 'sky'] },
  { id: 'n5_ki_spirit', char: '気', romaji: 'ki', type: 'kanji', meanings: ['spirit', 'feeling', 'air'] },
  { id: 'n5_sora', char: '空', romaji: 'sora', type: 'kanji', meanings: ['sky', 'empty'] },
  { id: 'n5_hanasu', char: '話', romaji: 'hanasu', type: 'kanji', meanings: ['speak', 'talk'] },
  { id: 'n5_yomu', char: '読', romaji: 'yomu', type: 'kanji', meanings: ['read'] },
  { id: 'n5_kaku', char: '書', romaji: 'kaku', type: 'kanji', meanings: ['write'] },
  { id: 'n5_dasu', char: '出', romaji: 'dasu', type: 'kanji', meanings: ['exit', 'put out'] },
  { id: 'n5_hairu', char: '入', romaji: 'hairu', type: 'kanji', meanings: ['enter'] },
  { id: 'n5_au', char: '会', romaji: 'au', type: 'kanji', meanings: ['meet'] },
  { id: 'n5_nagai', char: '長', romaji: 'nagai', type: 'kanji', meanings: ['long'] },
];

const DEFAULT_KANJI: CardItem[] = [
  { id: 'kj_nihon', char: '日本', romaji: 'nihon', type: 'kanji' },
  { id: 'kj_tokyo', char: '東京', romaji: 'tokyo', type: 'kanji' },
  { id: 'kj_kyoto', char: '京都', romaji: 'kyoto', type: 'kanji' },
  { id: 'kj_mizu', char: '水', romaji: 'mizu', type: 'kanji' },
  { id: 'kj_hi', char: '火', romaji: 'hi', type: 'kanji' },
  { id: 'kj_eki', char: '駅', romaji: 'eki', type: 'kanji' },
];

const DEFAULT_WORDS: CardItem[] = [
  { id: 'w_arigatou', char: 'ありがとう', romaji: 'arigatou', type: 'word', studyMode: 'words', meanings: ['thank you'] },
  { id: 'w_sumimasen', char: 'すみません', romaji: 'sumimasen', type: 'word', studyMode: 'words', meanings: ['excuse me', 'sorry'] },
  { id: 'w_onegaishimasu', char: 'お願いします', romaji: 'onegaishimasu', type: 'word', studyMode: 'words', meanings: ['please'] },
  { id: 'w_konnichiwa', char: 'こんにちは', romaji: 'konnichiwa', type: 'word', studyMode: 'words', meanings: ['hello', 'good afternoon'] },
  { id: 'w_ohayou', char: 'おはよう', romaji: 'ohayou', type: 'word', studyMode: 'words', meanings: ['good morning'] },
  { id: 'w_konbanwa', char: 'こんばんは', romaji: 'konbanwa', type: 'word', studyMode: 'words', meanings: ['good evening'] },
  { id: 'w_hai', char: 'はい', romaji: 'hai', type: 'word', studyMode: 'words', meanings: ['yes'] },
  { id: 'w_iie', char: 'いいえ', romaji: 'iie', type: 'word', studyMode: 'words', meanings: ['no'] },
  { id: 'w_mizu', char: '水', romaji: 'mizu', type: 'word', studyMode: 'words', meanings: ['water'] },
  { id: 'w_toire', char: 'トイレ', romaji: 'toire', type: 'word', studyMode: 'words', meanings: ['toilet', 'bathroom'] },
  { id: 'w_eki', char: '駅', romaji: 'eki', type: 'word', studyMode: 'words', meanings: ['station'] },
  { id: 'w_densha', char: '電車', romaji: 'densha', type: 'word', studyMode: 'words', meanings: ['train'] },
  { id: 'w_basutei', char: 'バス停', romaji: 'basutei', type: 'word', studyMode: 'words', meanings: ['bus stop'] },
  { id: 'w_kippu', char: '切符', romaji: 'kippu', type: 'word', studyMode: 'words', meanings: ['ticket'] },
  { id: 'w_hoteru', char: 'ホテル', romaji: 'hoteru', type: 'word', studyMode: 'words', meanings: ['hotel'] },
  { id: 'w_kudasai', char: 'ください', romaji: 'kudasai', type: 'word', studyMode: 'words', meanings: ['please', 'please give me'] },
  { id: 'w_ikura', char: 'いくら', romaji: 'ikura', type: 'word', studyMode: 'words', meanings: ['how much'] },
  { id: 'w_eigo', char: '英語', romaji: 'eigo', type: 'word', studyMode: 'words', meanings: ['English language'] },
  { id: 'w_wakarimasen', char: 'わかりません', romaji: 'wakarimasen', type: 'word', studyMode: 'words', meanings: ['I do not understand'] },
  { id: 'w_tasukete', char: '助けて', romaji: 'tasukete', type: 'word', studyMode: 'words', meanings: ['help me', 'please help'] },
];

// --- COMPONENTS ---

const DrawingPad = ({ onClearRef, disabled = false, onDrawStateChange }: DrawingPadProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const hasDrawnRef = useRef(false);

  useEffect(() => {
    if (onClearRef) {
      onClearRef.current = clearCanvas;
    }
  }, [onClearRef]);

  const clearCanvas = (): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    onDrawStateChange?.(false);
  };

  const getCoordinates = (e: DrawEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // Scale mapping for visual size vs internal resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e && e.touches.length > 0) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY
      };
    }
    const mouseEvent = e as React.MouseEvent<HTMLCanvasElement>;
    return {
      x: (mouseEvent.clientX - rect.left) * scaleX,
      y: (mouseEvent.clientY - rect.top) * scaleY
    };
  };

  const startDrawing = (e: DrawEvent): void => {
    if (disabled) return;
    e.preventDefault();
    setIsDrawing(true);
    const coords = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const draw = (e: DrawEvent): void => {
    if (!isDrawing || disabled) return;
    e.preventDefault();
    const coords = getCoordinates(e);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    if (!hasDrawnRef.current) {
      hasDrawnRef.current = true;
      onDrawStateChange?.(true);
    }
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = '#e4e4e7'; // zinc-200
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = (): void => {
    setIsDrawing(false);
  };

  return (
    <div className="relative w-full aspect-square max-h-[200px] bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-inner">
      <canvas
        ref={canvasRef}
        width={400} // internal resolution
        height={400}
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
        className={`w-full h-full touch-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-crosshair'}`}
        style={{ touchAction: 'none' }}
      />
      {!disabled && (
        <button 
          onClick={(e) => { e.stopPropagation(); clearCanvas(); }}
          className="absolute top-2 right-2 p-1.5 bg-zinc-800 text-zinc-400 rounded-md hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
        >
          <RefreshCw size={16} />
        </button>
      )}
    </div>
  );
};

const getTypeBadgeClasses = (type: CardType): string => {
  switch (type) {
    case 'hiragana': return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    case 'katakana': return 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30';
    case 'word': return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
    case 'kanji': return 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
    default: return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
  }
};

const getCardThemeClasses = (type: CardType, assessedState: ReviewResult | null, revealed: boolean): string => {
  let bgClass = '';
  let borderClass = '';

  switch (type) {
    case 'hiragana': 
      bgClass = revealed ? 'bg-blue-900/40' : 'bg-blue-950/30'; 
      borderClass = 'border-blue-900/50'; 
      break;
    case 'katakana': 
      bgClass = revealed ? 'bg-fuchsia-900/35' : 'bg-fuchsia-950/25'; 
      borderClass = 'border-fuchsia-900/50'; 
      break;
    case 'kanji': 
      bgClass = revealed ? 'bg-amber-900/40' : 'bg-amber-950/30'; 
      borderClass = 'border-amber-900/50'; 
      break;
    case 'word': 
      bgClass = revealed ? 'bg-emerald-950/35' : 'bg-emerald-950/20'; 
      borderClass = 'border-emerald-900/40'; 
      break;
    default: 
      bgClass = revealed ? 'bg-zinc-900' : 'bg-zinc-950'; 
      borderClass = 'border-zinc-800'; 
      break;
  }

  return `${bgClass} ${borderClass}`;
};

const formatMeanings = (card: CardItem): string => (card.meanings?.filter(Boolean) ?? []).join(', ');

const normalizeRomajiResponse = (value: string): string => (
  value.trim().toLowerCase().replace(/\s+/g, ' ')
);

const Flashcard = ({
  card,
  direction,
  directionStats,
  onAssess,
  onPlaySound,
  onTriggerHaptics,
}: FlashcardProps) => {
  const [revealed, setRevealed] = useState(false);
  const [assessedState, setAssessedState] = useState<ReviewResult | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [hadDrawingOnReveal, setHadDrawingOnReveal] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [checkedAnswer, setCheckedAnswer] = useState<ReviewResult | null>(null);
  const clearPadRef = useRef<(() => void) | null>(null);
  const studyMode = getCardStudyMode(card);
  const meaningsText = formatMeanings(card);
  const kanaPreview = typedAnswer ? toKana(typedAnswer) : '';

  // Reset state if card changes
  useEffect(() => {
    setRevealed(false);
    setAssessedState(null);
    setHasDrawn(false);
    setHadDrawingOnReveal(false);
    setTypedAnswer('');
    setCheckedAnswer(null);
    if (clearPadRef.current) clearPadRef.current();
  }, [card.id]);

  const handleReveal = (): void => {
    setHadDrawingOnReveal(hasDrawn);
    setRevealed(true);
    onPlaySound?.('reveal');
    onTriggerHaptics?.('reveal');
  };

  const handleAssess = (result: ReviewResult): void => {
    setAssessedState(result);
    onPlaySound?.(result);
    onTriggerHaptics?.(result);
    // Add a slight delay for visual feedback before telling parent to move on
    setTimeout(() => {
      onAssess(card, result);
    }, 300);
  };

  const promptText = direction === 'r2k' ? card.romaji : card.char;
  const answerText = direction === 'r2k' ? card.char : card.romaji;
  const strengthMeta = getCardStrengthMeta(directionStats);

  if (studyMode === 'words' && direction === 'r2k') {
    return (
      <div className={`flex flex-col w-full max-w-sm mx-auto border ${getCardThemeClasses('word', assessedState, revealed)} rounded-3xl p-6 shadow-2xl transition-all duration-300 relative overflow-hidden`}>
        <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${getTypeBadgeClasses('word')}`}>words</span>
          <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${strengthMeta.classes}`}>{strengthMeta.label}</span>
        </div>
        <div className="mb-6 text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.28em] text-zinc-500">Meaning</p>
          <h2 className="text-3xl font-bold leading-tight text-zinc-100">{meaningsText || 'No meaning set'}</h2>
          <p className="mt-3 text-sm text-zinc-500">Type the romaji. Kana preview updates as you go.</p>
        </div>
        <div className="mb-4 space-y-3">
          <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" lang="ja-Latn" placeholder="Type romaji" value={typedAnswer} onChange={(event) => setTypedAnswer(event.target.value)} disabled={checkedAnswer !== null} className="w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4 text-lg text-zinc-100 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-70" />
          <div className="rounded-2xl border border-emerald-950/60 bg-zinc-950/80 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Kana preview</p>
            <p className="mt-2 min-h-[1.75rem] text-lg text-emerald-300">{kanaPreview || '...'}</p>
          </div>
        </div>
        {checkedAnswer === null ? (
          <button onClick={() => { const result = normalizeRomajiResponse(typedAnswer) === normalizeRomajiResponse(card.romaji) ? 'gotIt' : 'missed'; setRevealed(true); setCheckedAnswer(result); setAssessedState(result); onPlaySound?.(result); onTriggerHaptics?.(result); }} disabled={!typedAnswer.trim()} className="w-full rounded-xl bg-zinc-100 py-4 text-lg font-bold text-zinc-950 shadow-md transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500">
            Check Answer
          </button>
        ) : (
          <div className="animate-in fade-in duration-300 space-y-4">
            <div className={`rounded-2xl border px-4 py-4 ${checkedAnswer === 'gotIt' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-rose-500/30 bg-rose-500/10'}`}>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-400">Correct answer</p>
              <p className="mt-2 text-2xl font-bold text-zinc-100">{card.romaji}</p>
              <p className="mt-2 text-lg text-emerald-300">{card.char}</p>
            </div>
            <button onClick={() => handleAssess(checkedAnswer)} className={`flex w-full items-center justify-center gap-2 rounded-xl py-4 text-lg font-bold transition-colors ${checkedAnswer === 'gotIt' ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-rose-500 text-white hover:bg-rose-600'}`}>
              {checkedAnswer === 'gotIt' ? <Check size={20} /> : <X size={20} />}
              Continue
            </button>
          </div>
        )}
      </div>
    );
  }

  if (studyMode === 'words') {
    return (
      <div className={`flex flex-col w-full max-w-sm mx-auto border ${getCardThemeClasses('word', assessedState, revealed)} rounded-3xl p-8 shadow-2xl transition-all duration-300 min-h-[320px] relative overflow-hidden`}>
        <div className="text-center flex-1 flex flex-col items-center justify-center relative">
          <div className="absolute top-0 flex flex-wrap items-center justify-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${getTypeBadgeClasses('word')}`}>words</span>
            <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${strengthMeta.classes}`}>{strengthMeta.label}</span>
          </div>
          {!revealed ? (
            <div className="flex flex-col items-center justify-center mt-4 h-32">
              <h2 className="text-6xl font-bold text-zinc-100 leading-none">{card.char}</h2>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center mt-4 text-center animate-in fade-in duration-300">
              <h2 className="text-5xl font-bold text-zinc-100 leading-none">{card.char}</h2>
              <p className="mt-4 text-2xl font-semibold text-emerald-300">{card.romaji}</p>
              <p className="mt-3 text-base text-zinc-300">{meaningsText}</p>
            </div>
          )}
        </div>
        <div className="mt-8">
          {!revealed ? (
            <button onClick={handleReveal} className="w-full py-4 bg-zinc-100 text-zinc-950 rounded-xl font-bold text-lg hover:bg-zinc-200 transition-colors shadow-md">Reveal</button>
          ) : (
            <div className="flex gap-3 animate-in fade-in duration-300">
              <button onClick={() => handleAssess('missed')} disabled={!!assessedState} className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-colors ${assessedState === 'missed' ? 'bg-rose-500 text-white' : 'bg-zinc-900 text-rose-400 hover:bg-rose-500/20'}`}>
                <X size={20} /> Missed
              </button>
              <button onClick={() => handleAssess('gotIt')} disabled={!!assessedState} className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-colors ${assessedState === 'gotIt' ? 'bg-emerald-500 text-white' : 'bg-zinc-900 text-emerald-400 hover:bg-emerald-500/20'}`}>
                <Check size={20} /> Got it
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Specific rendering for Romaji -> Kana (includes drawing pad)
  if (direction === 'r2k') {
    return (
      <div className={`flex flex-col w-full max-w-sm mx-auto border ${getCardThemeClasses(card.type, assessedState, revealed)} rounded-3xl p-6 shadow-2xl transition-all duration-300 relative overflow-hidden`}>
        <div className="text-center mb-4 flex flex-col items-center min-h-[110px] justify-end">
          <div className="mb-auto flex flex-wrap items-center justify-center gap-2">
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${getTypeBadgeClasses(card.type)}`}>
              {card.type}
            </span>
            <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${strengthMeta.classes}`}>
              {strengthMeta.label}
            </span>
          </div>
          {revealed ? (
            <div className="flex flex-col items-center animate-in slide-in-from-bottom-2 fade-in duration-300 mt-2">
              <h2 className="text-6xl font-bold text-zinc-50 leading-none drop-shadow-md">{answerText}</h2>
              {meaningsText && <p className="mt-3 text-center text-sm text-zinc-400">{meaningsText}</p>}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center mt-2 h-[84px]">
              <h2 className="text-5xl font-bold text-zinc-100 leading-none">{promptText}</h2>
            </div>
          )}
        </div>

        <div className="mb-6 relative">
          <DrawingPad
            onClearRef={clearPadRef}
            disabled={!!assessedState}
            onDrawStateChange={setHasDrawn}
          />
        </div>

        {!revealed ? (
          <button 
            onClick={handleReveal}
            className="w-full py-4 bg-zinc-100 text-zinc-950 rounded-xl font-bold text-lg hover:bg-zinc-200 transition-colors shadow-md"
          >
            Reveal
          </button>
        ) : (
          <div className="flex gap-3 animate-in slide-in-from-bottom-4 duration-300">
             <button 
              onClick={() => handleAssess('missed')}
              disabled={!!assessedState}
              className={`flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-colors ${hadDrawingOnReveal ? 'flex-1' : 'w-full'}
                ${assessedState === 'missed' ? 'bg-rose-500 text-white' : 'bg-zinc-900 text-rose-400 hover:bg-rose-500/20'}`}
            >
              <X size={20} /> Missed
            </button>
            {hadDrawingOnReveal && (
              <button 
                onClick={() => handleAssess('gotIt')}
                disabled={!!assessedState}
                className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-colors
                  ${assessedState === 'gotIt' ? 'bg-emerald-500 text-white' : 'bg-zinc-900 text-emerald-400 hover:bg-emerald-500/20'}`}
              >
                <Check size={20} /> Got it
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Specific rendering for Kana -> Romaji (simple flip)
  return (
    <div className={`flex flex-col w-full max-w-sm mx-auto border ${getCardThemeClasses(card.type, assessedState, revealed)} rounded-3xl p-8 shadow-2xl transition-all duration-300 min-h-[320px] relative overflow-hidden`}>
        <div className="text-center flex-1 flex flex-col items-center justify-center relative">
          <div className="absolute top-0 flex flex-wrap items-center justify-center gap-2">
            <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${getTypeBadgeClasses(card.type)}`}>
              {card.type}
            </span>
            <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${strengthMeta.classes}`}>
              {strengthMeta.label}
            </span>
          </div>
          
          <div className="relative w-full h-32 flex items-center justify-center mt-4">
             <h2 className={`text-8xl font-bold text-zinc-100 transition-all duration-500 absolute ${revealed ? 'opacity-0 scale-90 translate-y-4' : 'opacity-100 scale-100 translate-y-0'}`}>
                {promptText}
             </h2>
             <h2 className={`text-6xl font-bold text-zinc-100 transition-all duration-500 absolute ${revealed ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-110 -translate-y-4'}`}>
                 {answerText}
              </h2>
           </div>
           {revealed && meaningsText && (
             <p className="mt-4 text-center text-sm text-zinc-400 animate-in fade-in duration-300">{meaningsText}</p>
           )}
         </div>

        <div className="mt-8">
          {!revealed ? (
            <button 
              onClick={handleReveal}
              className="w-full py-4 bg-zinc-100 text-zinc-950 rounded-xl font-bold text-lg hover:bg-zinc-200 transition-colors shadow-md"
            >
              Reveal
            </button>
          ) : (
            <div className="flex gap-3 animate-in fade-in duration-300">
               <button 
                onClick={() => handleAssess('missed')}
                disabled={!!assessedState}
                className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-colors
                  ${assessedState === 'missed' ? 'bg-rose-500 text-white' : 'bg-zinc-900 text-rose-400 hover:bg-rose-500/20'}`}
              >
                <X size={20} /> Missed
              </button>
              <button 
                onClick={() => handleAssess('gotIt')}
                disabled={!!assessedState}
                className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-colors
                  ${assessedState === 'gotIt' ? 'bg-emerald-500 text-white' : 'bg-zinc-900 text-emerald-400 hover:bg-emerald-500/20'}`}
              >
                <Check size={20} /> Got it
              </button>
            </div>
          )}
        </div>
    </div>
  );
};

const PracticeSession = ({
  activePool,
  studyMode,
  direction,
  stats,
  onUpdateStats,
  onPlaySound,
  onTriggerHaptics,
}: PracticeSessionProps) => {
  const [queue, setQueue] = useState<CardItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionActive, setSessionActive] = useState(() => activePool.length > 0);

  const startSession = useCallback(() => {
    // Prioritize due, weak, and new cards to support spaced repetition.
    setQueue(buildAdaptiveQueue(activePool, stats, direction, 15));
    setCurrentIndex(0);
    setSessionActive(true);
  }, [activePool, stats, direction]);

  // Initial auto-start if pool is available
  useEffect(() => {
    if (activePool.length === 0) {
      setQueue([]);
      setCurrentIndex(0);
      setSessionActive(false);
      return;
    }

    if (queue.length === 0) {
      startSession();
    }
  }, [activePool, queue.length, startSession]);

  const handleAssess = (card: CardItem, result: ReviewResult): void => {
    onUpdateStats(card.id, result, direction);
    setCurrentIndex(prev => prev + 1);
  };

  if (activePool.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="max-w-xs text-zinc-400">
          <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p>{studyMode === 'words' ? 'No words available yet. Add or restore some words in Settings.' : 'No cards available. Please enable categories in Settings or add custom items.'}</p>
        </div>
      </div>
    );
  }

  const isPreparingSession = activePool.length > 0 && queue.length === 0;
  const isSessionComplete = queue.length > 0 && currentIndex >= queue.length;
  const currentCard = queue[currentIndex];

  if (isPreparingSession) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="max-w-xs text-zinc-400">
          <RefreshCw className="w-10 h-10 mx-auto mb-4 animate-spin text-zinc-600" />
          <p>Preparing your session...</p>
        </div>
      </div>
    );
  }

  if (!sessionActive || isSessionComplete) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
        <div className="w-24 h-24 bg-zinc-900 rounded-full flex items-center justify-center mb-6">
          <Check className="w-12 h-12 text-emerald-500" />
        </div>
        <h2 className="text-3xl font-bold text-zinc-100 mb-2">Session Complete!</h2>
        <p className="text-zinc-400 mb-8">Great job keeping up with your practice.</p>
        <button 
          onClick={startSession}
          className="px-8 py-4 bg-zinc-100 text-zinc-950 rounded-full font-bold text-lg hover:bg-zinc-200 transition-colors shadow-lg flex items-center gap-2"
        >
          Start Next Session <ArrowRight size={20} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-24 pt-6 px-4">
      <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
        <div className="w-full max-w-sm mb-6 flex items-center justify-between text-zinc-500 text-sm font-medium">
           <span>Card {currentIndex + 1} of {queue.length}</span>
           <div className="flex gap-1">
             {queue.map((_, i) => (
               <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === currentIndex ? 'bg-zinc-100' : i < currentIndex ? 'bg-zinc-800' : 'bg-zinc-900'}`} />
             ))}
           </div>
        </div>
        <Flashcard 
          key={currentCard.id} // Force remount on change for clean state
          card={currentCard} 
          direction={direction} 
          directionStats={getScheduledDirectionStats(stats, currentCard.id, direction)}
          onAssess={handleAssess}
          onPlaySound={onPlaySound}
          onTriggerHaptics={onTriggerHaptics}
        />
      </div>
    </div>
  );
};

const StatsView = ({ stats, allItems, activePool, studyMode }: StatsViewProps) => {
  const [activeStatsTab, setActiveStatsTab] = useState<Direction>('k2r');
  const [selectedItem, setSelectedItem] = useState<AnalyzedStatItem | CardItem | null>(null);

  const activeIdentityKeys = useMemo(() => new Set(activePool.map(item => getItemIdentityKey(item))), [activePool]);
  const visibleGroups = useMemo(() => {
    const groupedItems = new Map<string, CardItem[]>();

    allItems.forEach(item => {
      const key = getItemIdentityKey(item);
      const existingGroup = groupedItems.get(key);
      if (existingGroup) {
        existingGroup.push(item);
      } else {
        groupedItems.set(key, [item]);
      }
    });

    return Array.from(groupedItems.entries())
      .filter(([key]) => activeIdentityKeys.has(key))
      .map(([, items]) => items);
  }, [activeIdentityKeys, allItems]);

  // Helper to compute weak/improving/strong based on a specific direction
  const analyzeStats = (direction: Direction) => {
    const weak: AnalyzedStatItem[] = [];
    const strong: AnalyzedStatItem[] = [];
    const improving: AnalyzedStatItem[] = [];
    const unintroduced: CardItem[] = [];

    visibleGroups.forEach(groupItems => {
      const analyzedItems = groupItems
        .map(item => {
          const itemStat = getScheduledDirectionStats(stats, item.id, direction);
          const strengthMeta = getCardStrengthMeta(itemStat);

          return {
            item,
            itemStat,
            strengthMeta,
          };
        })
        .sort((a, b) => {
          if (b.itemStat.reviews !== a.itemStat.reviews) {
            return b.itemStat.reviews - a.itemStat.reviews;
          }

          return (b.itemStat.lastReviewedAt ?? 0) - (a.itemStat.lastReviewedAt ?? 0);
        });

      const introducedItem = analyzedItems.find(entry => entry.itemStat.reviews > 0);
      if (!introducedItem) {
        unintroduced.push(groupItems[0]);
        return;
      }

      const { item, itemStat, strengthMeta } = introducedItem;
      const analyzedStatItem: AnalyzedStatItem = {
        ...item,
        ...itemStat,
        ratio: strengthMeta.accuracy,
        usesRecentWindow: strengthMeta.usesRecentWindow,
        groupItems,
      };

      if (strengthMeta.bucket === 'weak') {
        weak.push(analyzedStatItem);
      } else if (strengthMeta.bucket === 'strong') {
        strong.push(analyzedStatItem);
      } else {
        improving.push(analyzedStatItem);
      }
    });

    return {
      weak: weak.sort((a, b) => a.ratio - b.ratio),
      improving: improving.sort((a, b) => b.ratio - a.ratio),
      strong: strong.sort((a, b) => b.ratio - a.ratio),
      unintroduced: unintroduced.sort((a, b) => a.char.localeCompare(b.char, 'ja')),
    };
  };

  const readingStats = useMemo(() => analyzeStats('k2r'), [stats, visibleGroups]);
  const writingStats = useMemo(() => analyzeStats('r2k'), [stats, visibleGroups]);

  const statsTabs: Array<{
    id: Direction;
    label: string;
    icon: typeof BookOpen;
    description: string;
    data: ReturnType<typeof analyzeStats>;
  }> = [
    {
      id: 'k2r',
      label: studyMode === 'words' ? 'Recognition Words' : 'Recognition Stats',
      icon: BookOpen,
      description: studyMode === 'words' ? 'How well you recognize Japanese words and their meanings.' : 'How well you recognize characters and their readings.',
      data: readingStats,
    },
    {
      id: 'r2k',
      label: studyMode === 'words' ? 'Recall Words' : 'Recall Stats',
      icon: Edit3,
      description: studyMode === 'words' ? 'How well you recall romaji from meanings.' : 'How well you recall the correct Japanese text from memory.',
      data: writingStats,
    },
  ];

  const activeTabIndex = statsTabs.findIndex(tab => tab.id === activeStatsTab);
  const activeStats = statsTabs[activeTabIndex] ?? statsTabs[0];

  useEffect(() => {
    if (!selectedItem) {
      return undefined;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedItem(null);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [selectedItem]);

  const StatTile = ({
    item,
    colorClass,
    ratio,
    usesRecentWindow,
  }: {
    item: AnalyzedStatItem | CardItem;
    colorClass: string;
    ratio?: number;
    usesRecentWindow?: boolean;
  }) => (
    <button
      type="button"
      onClick={() => setSelectedItem(item)}
      className="relative flex min-w-[4.75rem] flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-center transition-colors hover:border-zinc-700 hover:bg-zinc-800/90"
    >
      {typeof usesRecentWindow === 'boolean' ? (
        <span
          className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full ${
            usesRecentWindow ? 'bg-emerald-400' : 'bg-rose-400'
          }`}
          title={usesRecentWindow ? 'Using recent reviews' : 'Using older long-term stats'}
        />
      ) : null}
      <span className="mb-1 text-2xl font-bold text-zinc-100">{item.char}</span>
      {studyMode === 'words' && item.meanings?.length ? (
        <span className="mb-1 text-center text-xs text-zinc-500">{item.meanings.join(', ')}</span>
      ) : null}
      <span className={`text-xs font-bold ${colorClass}`}>
        {typeof ratio === 'number' ? `${Math.round(ratio * 100)}%` : 'New'}
      </span>
    </button>
  );

  const StatSection = ({ title, items, colorClass }: StatSectionProps) => (
    <section className="mb-8 last:mb-0">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-2xl font-bold text-zinc-100">{title}</h3>
        <span className="text-sm font-medium text-zinc-500">{items.length} items</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-center text-sm text-zinc-600">
          No items here yet.
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {items.map(item => (
            <StatTile key={item.id} item={item} colorClass={colorClass} ratio={item.ratio} usesRecentWindow={item.usesRecentWindow} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="flex-1 overflow-y-auto pb-24 px-4 pt-5 sm:px-6">
      <div className="mb-4 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-zinc-500">{studyMode === 'words' ? 'Words Mode' : 'Characters Mode'}</p>
        <p className="mt-2 text-sm text-zinc-400">{activeStats.description}</p>
      </div>
      <div className="mb-6 flex justify-center">
        <div className="inline-flex max-w-full rounded-full border border-zinc-800 bg-zinc-900/90 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="relative inline-grid grid-cols-2 gap-1">
          <div
            className="absolute inset-y-0 left-0 w-[calc(50%-0.125rem)] rounded-full bg-zinc-700/95 shadow-lg transition-transform duration-300 ease-out"
            style={{ transform: `translateX(calc(${activeTabIndex} * 100% + ${activeTabIndex * 0.25}rem))` }}
          />
          {statsTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = tab.id === activeStatsTab;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveStatsTab(tab.id)}
                className={`relative z-10 flex min-w-[10.5rem] items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition-colors ${
                  isActive ? 'text-zinc-50' : 'text-zinc-400'
                }`}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        </div>
      </div>

      <StatSection title="Strong" items={activeStats.data.strong} colorClass="text-emerald-400" />
      <StatSection title="Improving" items={activeStats.data.improving} colorClass="text-amber-400" />
      <StatSection title="Needs Work" items={activeStats.data.weak} colorClass="text-rose-400" />
      <section className="mb-8 last:mb-0">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-2xl font-bold text-zinc-100">Yet to Appear</h3>
          <span className="text-sm font-medium text-zinc-500">{activeStats.data.unintroduced.length} items</span>
        </div>
        {activeStats.data.unintroduced.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 text-center text-sm text-zinc-600">
            Everything visible here has been introduced.
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {activeStats.data.unintroduced.map(item => (
              <StatTile key={item.id} item={item} colorClass="text-sky-400" />
            ))}
          </div>
        )}
      </section>

      {selectedItem ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <button type="button" aria-label="Close item details" className="absolute inset-0 cursor-default" onClick={() => setSelectedItem(null)} />
          <div className="relative z-10 w-full max-w-md rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-zinc-500">
                  {studyMode === 'words' ? 'Word Details' : 'Character Details'}
                </p>
                <h3 className="mt-3 text-4xl font-bold text-zinc-100">{selectedItem.char}</h3>
                <p className="mt-2 text-lg text-emerald-300">{selectedItem.romaji}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="rounded-full border border-zinc-800 p-2 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
              >
                <X size={18} />
              </button>
            </div>

            {selectedItem.meanings?.length ? (
              <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Meanings</p>
                <p className="mt-2 text-sm leading-6 text-zinc-200">{selectedItem.meanings.join(', ')}</p>
              </div>
            ) : null}

            {'ratio' in selectedItem ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Accuracy</p>
                    <p className="mt-2 text-2xl font-bold text-zinc-100">{Math.round(selectedItem.ratio * 100)}%</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Reviews</p>
                    <p className="mt-2 text-2xl font-bold text-zinc-100">{selectedItem.reviews}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Streak</p>
                    <p className="mt-2 text-2xl font-bold text-zinc-100">{selectedItem.streak}</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Next Review</p>
                    <p className="mt-2 text-lg font-bold text-zinc-100">{formatDueLabel(selectedItem)}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Classification Basis</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {selectedItem.usesRecentWindow ? 'Using recent results for this item.' : 'Using older lifetime stats until there are enough recent reviews.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Status</p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  This item has not been introduced in this practice direction yet.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const SettingsView = ({
  settings,
  setSettings,
  customItems,
  setCustomItems,
  wordItems,
  setWordItems,
  hapticsSupported,
}: {
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState>>;
  customItems: CardItem[];
  setCustomItems: React.Dispatch<React.SetStateAction<CardItem[]>>;
  wordItems: CardItem[];
  setWordItems: React.Dispatch<React.SetStateAction<CardItem[]>>;
  hapticsSupported: boolean;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isEditingWords, setIsEditingWords] = useState(false);
  const [storageExport, setStorageExport] = useState('');
  const [exportMessage, setExportMessage] = useState('');
  const [showStorageExport, setShowStorageExport] = useState(false);
  const [newItemChar, setNewItemChar] = useState('');
  const [newItemRomaji, setNewItemRomaji] = useState('');
  const [newWordChar, setNewWordChar] = useState('');
  const [newWordRomaji, setNewWordRomaji] = useState('');
  const [newWordMeanings, setNewWordMeanings] = useState('');

  const Toggle = ({ label, checked, onChange }: ToggleProps) => (
    <label className="flex items-center justify-between p-4 bg-zinc-900 rounded-2xl cursor-pointer hover:bg-zinc-800/80 transition-colors mb-3">
      <span className="text-zinc-200 font-medium">{label}</span>
      <div className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ${checked ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
        <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-300 ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
      </div>
      <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );

  const handleAddItem = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!newItemChar.trim() || !newItemRomaji.trim()) return;
    
      const newItem: CardItem = {
        id: `custom_${Date.now()}`,
        char: newItemChar.trim(),
        romaji: newItemRomaji.trim().toLowerCase(),
      type: 'kanji' // Defaulting to kanji for custom, though words also work
    };

    setCustomItems(prev => [...prev, newItem]);
    setNewItemChar('');
    setNewItemRomaji('');
  };

  const removeCustomItem = (id: string): void => {
    setCustomItems(prev => prev.filter(item => item.id !== id));
  };

  const handleAddWord = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const meanings = newWordMeanings.split(',').map(meaning => meaning.trim()).filter(Boolean);
    if (!newWordChar.trim() || !newWordRomaji.trim() || meanings.length === 0) return;

    const newWord: CardItem = {
      id: `word_${Date.now()}`,
      char: newWordChar.trim(),
      romaji: newWordRomaji.trim().toLowerCase(),
      type: 'word',
      studyMode: 'words',
      meanings,
    };

    setWordItems(prev => [...prev, newWord]);
    setNewWordChar('');
    setNewWordRomaji('');
    setNewWordMeanings('');
  };

  const removeWordItem = (id: string): void => {
    setWordItems(prev => prev.filter(item => item.id !== id));
  };

  const handleExportStorage = async (): Promise<void> => {
    const payload = buildLocalStorageExport();
    setStorageExport(payload);
    setShowStorageExport(false);

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(payload);
        setExportMessage('Copied local data to clipboard.');
        return;
      } catch {
        // Fall through to manual copy state below.
      }
    }

    setShowStorageExport(true);
    setExportMessage('Clipboard access was unavailable. Use the text box below to copy manually.');
  };

  useEffect(() => {
    if (!exportMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setExportMessage('');
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [exportMessage]);

  return (
    <div className="flex-1 overflow-y-auto pb-24 p-6">
      {exportMessage && (
        <div className="sticky top-4 z-20 mb-4 flex justify-center pointer-events-none">
          <div className="rounded-full border border-emerald-400/25 bg-zinc-950/95 px-4 py-2 text-sm font-medium text-emerald-300 shadow-lg backdrop-blur">
            {exportMessage}
          </div>
        </div>
      )}
      <h2 className="text-3xl font-bold text-zinc-100 mb-8">Settings</h2>

      <div className="mb-8">
        <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4 ml-2">Study Side</h3>
        <div className="inline-flex rounded-full border border-zinc-800 bg-zinc-900 p-1 mb-4">
          {(['characters', 'words'] as StudyMode[]).map(mode => {
            const isActive = settings.studyMode === mode;
            return (
              <button key={mode} onClick={() => setSettings(s => ({ ...s, studyMode: mode }))} className={`rounded-full px-5 py-3 text-sm font-semibold transition-colors ${isActive ? 'bg-emerald-500 text-white' : 'text-zinc-400'}`}>
                {mode === 'characters' ? 'Characters' : 'Words'}
              </button>
            );
          })}
        </div>
        {settings.studyMode === 'characters' && (
          <>
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4 ml-2">Active Categories</h3>
            <Toggle label="Hiragana" checked={settings.hiragana} onChange={(val) => setSettings(s => ({ ...s, hiragana: val }))} />
            <Toggle label="Katakana" checked={settings.katakana} onChange={(val) => setSettings(s => ({ ...s, katakana: val }))} />
            <Toggle label="JLPT N5 Kanji" checked={settings.jlptN5Kanji} onChange={(val) => setSettings(s => ({ ...s, jlptN5Kanji: val }))} />
            <Toggle label="Custom Kanji" checked={settings.kanji} onChange={(val) => setSettings(s => ({ ...s, kanji: val }))} />
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4 ml-2 mt-6">Kana Variations</h3>
            <Toggle label="Dakuten" checked={settings.dakuten} onChange={(val) => setSettings(s => ({ ...s, dakuten: val }))} />
            <Toggle label="Handakuten" checked={settings.handakuten} onChange={(val) => setSettings(s => ({ ...s, handakuten: val }))} />
            <Toggle label="Yoon" checked={settings.yoon} onChange={(val) => setSettings(s => ({ ...s, yoon: val }))} />
          </>
        )}
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4 ml-2">Sound</h3>
        <Toggle label="Practice Sounds" checked={settings.soundEnabled} onChange={(val) => setSettings(s => ({ ...s, soundEnabled: val }))} />
        {hapticsSupported && (
          <Toggle label="Haptic Feedback" checked={settings.hapticsEnabled} onChange={(val) => setSettings(s => ({ ...s, hapticsEnabled: val }))} />
        )}
      </div>

      {settings.studyMode === 'words' && (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4 ml-2">
          <div>
            <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Words Deck</h3>
            <p className="mt-2 text-sm text-zinc-500">Starter beginner words plus anything you add.</p>
          </div>
          <button onClick={() => setIsEditingWords(!isEditingWords)} className="text-emerald-500 text-sm font-bold hover:text-emerald-400">
            {isEditingWords ? 'Done' : 'Edit'}
          </button>
        </div>

        {isEditingWords && (
          <form onSubmit={handleAddWord} className="bg-zinc-900 p-4 rounded-2xl mb-4 space-y-3">
            <input type="text" placeholder="Japanese word" value={newWordChar} onChange={(e) => setNewWordChar(e.target.value)} className="w-full bg-zinc-950 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 ring-emerald-500/50 border border-zinc-800" />
            <input type="text" placeholder="Romaji" value={newWordRomaji} onChange={(e) => setNewWordRomaji(e.target.value)} className="w-full bg-zinc-950 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 ring-emerald-500/50 border border-zinc-800" />
            <input type="text" placeholder="Meanings (comma separated)" value={newWordMeanings} onChange={(e) => setNewWordMeanings(e.target.value)} className="w-full bg-zinc-950 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 ring-emerald-500/50 border border-zinc-800" />
            <button type="submit" className="w-full bg-emerald-500 text-white p-3 rounded-xl hover:bg-emerald-600 transition-colors font-bold">Add Word</button>
          </form>
        )}

        <div className="space-y-2">
          {wordItems.map(item => (
            <div key={item.id} className="flex items-start justify-between bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800/50">
              <div>
                <div className="flex gap-4 items-baseline flex-wrap">
                  <span className="text-2xl font-bold text-zinc-100">{item.char}</span>
                  <span className="text-zinc-400">{item.romaji}</span>
                </div>
                <span className="text-sm text-zinc-500">{item.meanings?.join(', ')}</span>
              </div>
              {isEditingWords && (
                <button onClick={() => removeWordItem(item.id)} className="text-rose-500 hover:text-rose-400 p-2">
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
      )}

      {settings.studyMode === 'characters' && (
      <div>
        <div className="flex items-center justify-between mb-4 ml-2">
          <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Custom Deck</h3>
          <button 
            onClick={() => setIsEditing(!isEditing)}
            className="text-emerald-500 text-sm font-bold hover:text-emerald-400"
          >
            {isEditing ? 'Done' : 'Edit'}
          </button>
        </div>

        {isEditing && (
          <form onSubmit={handleAddItem} className="bg-zinc-900 p-4 rounded-2xl mb-4 flex gap-3">
            <input 
              type="text" 
              placeholder="漢字" 
              value={newItemChar}
              onChange={(e) => setNewItemChar(e.target.value)}
              className="w-1/3 bg-zinc-950 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 ring-emerald-500/50 border border-zinc-800"
            />
            <input 
              type="text" 
              placeholder="Romaji" 
              value={newItemRomaji}
              onChange={(e) => setNewItemRomaji(e.target.value)}
              className="flex-1 bg-zinc-950 text-white rounded-xl px-4 py-3 outline-none focus:ring-2 ring-emerald-500/50 border border-zinc-800"
            />
            <button type="submit" className="bg-emerald-500 text-white p-3 rounded-xl hover:bg-emerald-600 transition-colors">
              <Plus size={20} />
            </button>
          </form>
        )}

        <p className="mb-4 ml-2 text-sm text-zinc-500">Custom kanji stay separate from the built-in JLPT N5 deck.</p>

        <div className="space-y-2">
          {customItems.map(item => (
            <div key={item.id} className="flex items-center justify-between bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800/50">
               <div className="flex gap-4 items-baseline">
                 <span className="text-2xl font-bold text-zinc-100">{item.char}</span>
                 <span className="text-zinc-400">{item.romaji}</span>
               </div>
               {isEditing && (
                 <button onClick={() => removeCustomItem(item.id)} className="text-rose-500 hover:text-rose-400 p-2">
                   <Trash2 size={18} />
                 </button>
               )}
            </div>
          ))}
          {customItems.length === 0 && (
            <div className="text-center text-zinc-600 py-6">No custom items yet.</div>
          )}
        </div>
      </div>
      )}

      <div className="mt-8">
        <div className="mb-4 ml-2">
          <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Debug Export</h3>
          <p className="mt-2 text-sm text-zinc-500">Export this device's saved app data to help diagnose issues.</p>
        </div>
        <button
          onClick={() => { void handleExportStorage(); }}
          className="w-full rounded-2xl bg-zinc-900 px-4 py-4 text-left transition-colors hover:bg-zinc-800/80"
        >
          <span className="block text-zinc-100 font-medium">Copy Saved Data</span>
          <span className="mt-1 block text-sm text-zinc-500">Please send this data to the developers for assistance.</span>
        </button>
        {showStorageExport && storageExport && (
          <textarea
            readOnly
            value={storageExport}
            className="mt-4 min-h-[12rem] w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-300 outline-none"
          />
        )}
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

export default function App() {
  const activePage = useActivePage();
  useViewportHeightVar();
  const isMockStorageMode = import.meta.env.MODE === 'mock-storage';
  const [settings, setSettings] = useState<SettingsState>(() => loadStoredSettings());
  const [customItems, setCustomItems] = useState<CardItem[]>(() => loadStoredCardItems(CUSTOM_ITEMS_STORAGE_KEY, DEFAULT_KANJI, 'characters', 'kanji'));
  const [wordItems, setWordItems] = useState<CardItem[]>(() => loadStoredCardItems(WORD_ITEMS_STORAGE_KEY, DEFAULT_WORDS, 'words', 'word'));
  const audioContextRef = useRef<AudioContext | null>(null);
  const hapticsSupported = useMemo(() => isLikelyHapticsSupported(), []);
  
  // Stats map: { [id]: { r2k: { gotIt, missed, streak }, k2r: { gotIt, missed, streak } } }
  const [stats, setStats] = useState<StatsMap>(() => loadStoredStats());

  const allItems = useMemo<CardItem[]>(() => {
    if (settings.studyMode === 'words') {
      return wordItems.map(item => ({ ...item, studyMode: 'words' as StudyMode }));
    }

    return [
      ...[...BASE_HIRAGANA, ...HIRAGANA_DAKUTEN, ...HIRAGANA_HANDAKUTEN, ...HIRAGANA_YOON].map(item => ({ ...item, studyMode: 'characters' as StudyMode })),
      ...[...BASE_KATAKANA, ...KATAKANA_DAKUTEN, ...KATAKANA_HANDAKUTEN, ...KATAKANA_YOON].map(item => ({ ...item, studyMode: 'characters' as StudyMode })),
      ...JLPT_N5_KANJI.map(item => ({ ...item, studyMode: 'characters' as StudyMode })),
      ...customItems.map(item => ({ ...item, studyMode: 'characters' as StudyMode })),
    ];
  }, [customItems, settings, wordItems]);

  const activePool = useMemo<CardItem[]>(() => {
    if (settings.studyMode === 'words') {
      return wordItems.map(item => ({ ...item, studyMode: 'words' as StudyMode }));
    }

    const pool: CardItem[] = [];
    if (settings.hiragana) pool.push(...getEnabledHiraganaCards(settings).map(item => ({ ...item, studyMode: 'characters' as StudyMode })));
    if (settings.katakana) pool.push(...getEnabledKatakanaCards(settings).map(item => ({ ...item, studyMode: 'characters' as StudyMode })));
    if (settings.jlptN5Kanji) pool.push(...JLPT_N5_KANJI.map(item => ({ ...item, studyMode: 'characters' as StudyMode })));
    if (settings.kanji) pool.push(...customItems.map(item => ({ ...item, studyMode: 'characters' as StudyMode })));
    return pool;
  }, [settings, customItems, wordItems]);

  const updateStats = useCallback((id: string, result: ReviewResult, direction: Direction) => {
    setStats(prev => {
      const currentOverall = prev[id] || {};
      const currentDir = getScheduledDirectionStats(prev, id, direction);
      const nextDir = calculateNextDirectionStats(currentDir, result, Date.now());
      
      return {
        ...prev,
        [id]: {
          ...currentOverall,
          [direction]: nextDir,
        }
      };
    });
  }, []);

  const playFeedbackSound = useCallback((effectName: FeedbackEffect) => {
    if (!settings.soundEnabled || typeof window === 'undefined') return;

    const AudioContextClass: AudioConstructor | undefined = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    const audioContext = audioContextRef.current;
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    playSoundEffect(audioContext, effectName);
  }, [settings.soundEnabled]);

  const triggerHaptics = useCallback((effectName: FeedbackEffect) => {
    if (!settings.hapticsEnabled || !hapticsSupported) {
      return;
    }

    const pattern = HAPTIC_PATTERNS[effectName];
    if (!pattern) return;

    navigator.vibrate(pattern);
  }, [hapticsSupported, settings.hapticsEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
    } catch {
      // Ignore storage write failures so practice still works if storage is unavailable.
    }
  }, [stats]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      window.localStorage.setItem(SOUND_SETTINGS_KEY, String(settings.soundEnabled));
    } catch {
      // Ignore storage write failures so preferences stay optional.
    }
  }, [settings]);

  useEffect(() => {
    try {
      window.localStorage.setItem(HAPTICS_SETTINGS_KEY, String(settings.hapticsEnabled));
    } catch {
      // Ignore storage write failures so haptic preferences stay optional.
    }
  }, [settings.hapticsEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STUDY_MODE_STORAGE_KEY, settings.studyMode);
    } catch {
      // Ignore storage write failures so mode switching still works for the session.
    }
  }, [settings.studyMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_ITEMS_STORAGE_KEY, JSON.stringify(customItems));
    } catch {
      // Ignore storage write failures so practice still works if storage is unavailable.
    }
  }, [customItems]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORD_ITEMS_STORAGE_KEY, JSON.stringify(wordItems));
    } catch {
      // Ignore storage write failures so practice still works if storage is unavailable.
    }
  }, [wordItems]);

  const practiceSessionProps: PracticeSessionComponentProps = {
    activePool,
    studyMode: settings.studyMode,
    stats,
    onUpdateStats: updateStats,
    onPlaySound: playFeedbackSound,
    onTriggerHaptics: triggerHaptics,
  };

  return (
    <div className="app-shell flex flex-col max-w-2xl mx-auto bg-[#09090b] text-zinc-100 font-sans selection:bg-emerald-500/30 overflow-hidden relative shadow-2xl">
      {isMockStorageMode && (
        <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2">
          <div className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.24em] text-amber-300 shadow-lg backdrop-blur">
            Mock Storage
          </div>
        </div>
      )}
      
      {/* Header (optional, clean minimal bar) */}
      <div className="h-14 flex items-center justify-center border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md z-10 shrink-0">
         <h1 className="font-bold text-lg tracking-wide text-zinc-100">NIHONGO<span className="text-emerald-500">FLASH</span></h1>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col bg-[#09090b]">
        {activePage === 'recall' && (
          <RecallPage PracticeSessionComponent={PracticeSession} sessionProps={practiceSessionProps} />
        )}
        {activePage === 'recognize' && (
          <RecognizePage PracticeSessionComponent={PracticeSession} sessionProps={practiceSessionProps} />
        )}
        {activePage === 'stats' && (
          <StatsPage StatsViewComponent={StatsView} stats={stats} allItems={allItems} activePool={activePool} studyMode={settings.studyMode} />
        )}
        {activePage === 'settings' && (
          <SettingsPage
            SettingsViewComponent={SettingsView}
            settings={settings}
            setSettings={setSettings}
            customItems={customItems}
            setCustomItems={setCustomItems}
            wordItems={wordItems}
            setWordItems={setWordItems}
            hapticsSupported={hapticsSupported}
          />
        )}
      </div>

      {/* Bottom Navigation */}
      <nav className="absolute bottom-0 left-0 right-0 h-20 bg-zinc-950/90 backdrop-blur-lg border-t border-zinc-900 flex justify-around items-center px-4 pb-safe z-50">
        {NAV_PAGES.map(tab => {
          const Icon = tab.icon;
          const isActive = activePage === tab.id;
          return (
            <a
              key={tab.id}
              href={tab.href}
              className="flex flex-col items-center justify-center w-16 h-14 relative"
            >
              <div className={`transition-all duration-300 ${isActive ? 'text-emerald-400 -translate-y-1' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className={`text-[10px] font-bold mt-1 transition-all duration-300 ${isActive ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {tab.label}
              </span>
              {isActive && (
                <div className="absolute -bottom-2 w-1 h-1 bg-emerald-400 rounded-full shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              )}
            </a>
          );
        })}
      </nav>

    </div>
  );
}

