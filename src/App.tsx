import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Settings, BarChart2, Edit3, BookOpen, Check, X, RefreshCw, Plus, Trash2, ArrowRight } from 'lucide-react';
import HomePage from './pages/HomePage';
import WritePage from './pages/WritePage';
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
  StatsMap,
  StatsViewProps,
  StrengthMeta,
} from './types';

const STATS_STORAGE_KEY = 'nihongo-flash:stats';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const RECENT_RESULTS_LIMIT = 10;
const MIN_RECENT_REVIEWS_FOR_STRONG = 5;
const SOUND_SETTINGS_KEY = 'nihongo-flash:sound-enabled';
const HAPTICS_SETTINGS_KEY = 'nihongo-flash:haptics-enabled';

type PageId = 'home' | 'write' | 'stats' | 'settings';
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
  { id: 'home', label: 'Home', icon: BookOpen, href: '#/', title: 'Read' },
  { id: 'write', label: 'Write', icon: Edit3, href: '#/write', title: 'Write' },
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
      return 'home';
    case '/write':
      return 'write';
    case '/stats':
      return 'stats';
    case '/settings':
      return 'settings';
    default:
      return 'home';
  }
};

const useActivePage = (): PageId => {
  const [activePage, setActivePage] = useState<PageId>(() => {
    if (typeof window === 'undefined') return 'home';
    return normalizePageFromHash(window.location.hash);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncPage = () => {
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
  gotIt: 0,
  missed: 0,
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
        : 0;
      const missed = typeof safeDirectionStats.missed === 'number' && Number.isFinite(safeDirectionStats.missed)
        ? safeDirectionStats.missed
        : 0;
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
        : 0;

      directions[direction] = {
        gotIt,
        missed,
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

const getLifetimeAccuracy = (directionStats: DirectionStats): number => {
  const total = directionStats.gotIt + directionStats.missed;
  return total === 0 ? 0.5 : directionStats.gotIt / total;
};

const getRecentAccuracy = (directionStats: DirectionStats): number => {
  const recentResults = directionStats?.recentResults ?? [];
  if (recentResults.length === 0) {
    return 0.5;
  }

  const gotItCount = recentResults.reduce((total, value) => total + value, 0);
  return gotItCount / recentResults.length;
};

const hasRecentClassificationData = (directionStats: DirectionStats): boolean => (
  (directionStats?.recentResults?.length ?? 0) >= MIN_RECENT_REVIEWS_FOR_STRONG
);

const getEffectiveAccuracy = (directionStats: DirectionStats): number => (
  hasRecentClassificationData(directionStats)
    ? getRecentAccuracy(directionStats)
    : getLifetimeAccuracy(directionStats)
);

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
  const nextRecentResults = [...currentDirectionStats.recentResults, isGotIt ? 1 : 0].slice(-RECENT_RESULTS_LIMIT);

  if (!isGotIt) {
    return {
      ...currentDirectionStats,
      gotIt: currentDirectionStats.gotIt,
      missed: currentDirectionStats.missed + 1,
      streak: -1,
      reviews: nextReviews,
      recentResults: nextRecentResults,
      ease: Math.max(MIN_EASE, currentDirectionStats.ease - 0.2),
      intervalDays: 0,
      lastReviewedAt: reviewedAt,
      dueAt: reviewedAt,
    };
  }

  let nextIntervalDays = 1;
  if (currentDirectionStats.reviews === 1) {
    nextIntervalDays = 3;
  } else if (currentDirectionStats.reviews >= 2) {
    nextIntervalDays = Math.max(4, Math.round(Math.max(1, currentDirectionStats.intervalDays) * currentDirectionStats.ease));
  }

  return {
    ...currentDirectionStats,
    gotIt: currentDirectionStats.gotIt + 1,
    missed: currentDirectionStats.missed,
    streak: currentDirectionStats.streak + 1,
    reviews: nextReviews,
    recentResults: nextRecentResults,
    ease: clamp(currentDirectionStats.ease + 0.1, MIN_EASE, 3.0),
    intervalDays: nextIntervalDays,
    lastReviewedAt: reviewedAt,
    dueAt: reviewedAt + nextIntervalDays * DAY_IN_MS,
  };
};

const getCardPriority = (card: CardItem, stats: StatsMap, direction: Direction, now: number) => {
  const directionStats = getScheduledDirectionStats(stats, card.id, direction);
  const accuracy = getEffectiveAccuracy(directionStats);
  const isNew = directionStats.reviews === 0;
  const isDue = isNew || directionStats.dueAt <= now;
  const overdueDays = directionStats.dueAt ? Math.max(0, (now - directionStats.dueAt) / DAY_IN_MS) : 0;
  const upcomingDays = directionStats.dueAt > now ? (directionStats.dueAt - now) / DAY_IN_MS : 0;

  let score = 0;

  if (isDue) {
    score += 140;
  } else {
    score += Math.max(0, 35 - upcomingDays * 18);
  }

  score += overdueDays * 24;
  score += (1 - accuracy) * 55;
  score += directionStats.streak < 0 ? 18 : Math.max(0, 8 - directionStats.streak * 2);
  score += directionStats.reviews < 2 ? 14 : 0;
  score += isNew ? 22 : 0;
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

  const usesRecentWindow = hasRecentClassificationData(directionStats);
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
    directionStats.streak >= 3
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

  const dueCards = rankedCards.filter(entry => entry.isDue && !entry.isNew);
  const newCards = rankedCards.filter(entry => entry.isNew);
  const futureCards = rankedCards.filter(entry => !entry.isDue && !entry.isNew);

  const maxNewCards = clamp(Math.ceil(sessionSize * 0.25), 2, 4);
  const selected: CardItem[] = [];
  const selectedIds = new Set();

  const takeCards = (
    entries: Array<{ card: CardItem }>,
    limit: number,
  ): number => {
    for (const entry of entries) {
      if (selected.length >= sessionSize || limit <= 0) break;
      if (selectedIds.has(entry.card.id)) continue;
      selected.push(entry.card);
      selectedIds.add(entry.card.id);
      limit -= 1;
    }
    return limit;
  };

  let remainingNewSlots = Math.min(maxNewCards, newCards.length);
  takeCards(dueCards, sessionSize - remainingNewSlots);
  remainingNewSlots = takeCards(newCards, remainingNewSlots);

  if (selected.length < sessionSize) {
    takeCards(futureCards, sessionSize - selected.length);
  }

  if (selected.length < sessionSize && remainingNewSlots > 0) {
    takeCards(newCards, remainingNewSlots);
  }

  if (selected.length < sessionSize) {
    takeCards(rankedCards, sessionSize - selected.length);
  }

  return selected;
};

// --- DATA ---
const HIRAGANA: CardItem[] = [
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

const KATAKANA: CardItem[] = [
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

const DEFAULT_KANJI: CardItem[] = [
  { id: 'kj_nihon', char: '日本', romaji: 'nihon', type: 'kanji' },
  { id: 'kj_tokyo', char: '東京', romaji: 'tokyo', type: 'kanji' },
  { id: 'kj_kyoto', char: '京都', romaji: 'kyoto', type: 'kanji' },
  { id: 'kj_mizu', char: '水', romaji: 'mizu', type: 'kanji' },
  { id: 'kj_hi', char: '火', romaji: 'hi', type: 'kanji' },
  { id: 'kj_eki', char: '駅', romaji: 'eki', type: 'kanji' },
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
    case 'katakana': return 'bg-purple-500/20 text-purple-400 border border-purple-500/30';
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
      bgClass = revealed ? 'bg-purple-900/40' : 'bg-purple-950/30'; 
      borderClass = 'border-purple-900/50'; 
      break;
    case 'kanji': 
      bgClass = revealed ? 'bg-amber-900/40' : 'bg-amber-950/30'; 
      borderClass = 'border-amber-900/50'; 
      break;
    default: 
      bgClass = revealed ? 'bg-zinc-900' : 'bg-zinc-950'; 
      borderClass = 'border-zinc-800'; 
      break;
  }

  return `${bgClass} ${borderClass}`;
};

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
  const clearPadRef = useRef<(() => void) | null>(null);

  // Reset state if card changes
  useEffect(() => {
    setRevealed(false);
    setAssessedState(null);
    setHasDrawn(false);
    setHadDrawingOnReveal(false);
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
          <p>No cards available. Please enable categories in Settings or add custom items.</p>
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

const StatsView = ({ stats, allItems }: StatsViewProps) => {
  const [activeStatsTab, setActiveStatsTab] = useState<Direction>('k2r');

  // Helper to compute weak/improving/strong based on a specific direction
  const analyzeStats = (direction: Direction) => {
    const weak: AnalyzedStatItem[] = [];
    const strong: AnalyzedStatItem[] = [];
    const improving: AnalyzedStatItem[] = [];

    allItems.forEach(item => {
      const itemStat = getScheduledDirectionStats(stats, item.id, direction);
      if (itemStat.reviews === 0) return;

      const strengthMeta = getCardStrengthMeta(itemStat);
      const ratio = strengthMeta.accuracy;
      const usesRecentWindow = strengthMeta.usesRecentWindow;

      if (strengthMeta.bucket === 'weak') {
        weak.push({ ...item, ...itemStat, ratio, usesRecentWindow });
      } else if (strengthMeta.bucket === 'strong') {
        strong.push({ ...item, ...itemStat, ratio, usesRecentWindow });
      } else {
        improving.push({ ...item, ...itemStat, ratio, usesRecentWindow });
      }
    });

    return {
      weak: weak.sort((a, b) => a.ratio - b.ratio),
      improving: improving.sort((a, b) => b.ratio - a.ratio),
      strong: strong.sort((a, b) => b.ratio - a.ratio),
    };
  };

  const readingStats = useMemo(() => analyzeStats('k2r'), [stats, allItems]);
  const writingStats = useMemo(() => analyzeStats('r2k'), [stats, allItems]);

  const statsTabs: Array<{
    id: Direction;
    label: string;
    icon: typeof BookOpen;
    description: string;
    data: ReturnType<typeof analyzeStats>;
  }> = [
    {
      id: 'k2r',
      label: 'Reading Stats',
      icon: BookOpen,
      description: 'Accuracy for recognizing characters and words.',
      data: readingStats,
    },
    {
      id: 'r2k',
      label: 'Writing Stats',
      icon: Edit3,
      description: 'Accuracy for recalling the correct Japanese text.',
      data: writingStats,
    },
  ];

  const activeTabIndex = statsTabs.findIndex(tab => tab.id === activeStatsTab);
  const activeStats = statsTabs[activeTabIndex] ?? statsTabs[0];
  const totalReviewed = activeStats.data.weak.length + activeStats.data.improving.length + activeStats.data.strong.length;

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
            <div
              key={item.id}
              className="relative flex min-w-[4.75rem] flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3"
            >
              <span
                className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full ${
                  item.usesRecentWindow ? 'bg-emerald-400' : 'bg-rose-400'
                }`}
                title={item.usesRecentWindow ? 'Using recent reviews' : 'Using older long-term stats'}
              />
              <span className="mb-1 text-2xl font-bold text-zinc-100">{item.char}</span>
              <span className={`text-xs font-bold ${colorClass}`}>{Math.round(item.ratio * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="flex-1 overflow-y-auto pb-24 px-4 pt-5 sm:px-6">
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
    </div>
  );
};

const SettingsView = ({
  settings,
  setSettings,
  customItems,
  setCustomItems,
  hapticsSupported,
}: {
  settings: SettingsState;
  setSettings: React.Dispatch<React.SetStateAction<SettingsState>>;
  customItems: CardItem[];
  setCustomItems: React.Dispatch<React.SetStateAction<CardItem[]>>;
  hapticsSupported: boolean;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [newItemChar, setNewItemChar] = useState('');
  const [newItemRomaji, setNewItemRomaji] = useState('');

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

  return (
    <div className="flex-1 overflow-y-auto pb-24 p-6">
      <h2 className="text-3xl font-bold text-zinc-100 mb-8">Settings</h2>

      <div className="mb-8">
        <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4 ml-2">Active Categories</h3>
        <Toggle label="Hiragana" checked={settings.hiragana} onChange={(val) => setSettings(s => ({ ...s, hiragana: val }))} />
        <Toggle label="Katakana" checked={settings.katakana} onChange={(val) => setSettings(s => ({ ...s, katakana: val }))} />
        <Toggle label="Kanji / Words (Custom)" checked={settings.kanji} onChange={(val) => setSettings(s => ({ ...s, kanji: val }))} />
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4 ml-2">Sound</h3>
        <Toggle label="Practice Sounds" checked={settings.soundEnabled} onChange={(val) => setSettings(s => ({ ...s, soundEnabled: val }))} />
        {hapticsSupported && (
          <Toggle label="Haptic Feedback" checked={settings.hapticsEnabled} onChange={(val) => setSettings(s => ({ ...s, hapticsEnabled: val }))} />
        )}
      </div>

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
    </div>
  );
};

// --- MAIN APP COMPONENT ---

export default function App() {
  const activePage = useActivePage();
  useViewportHeightVar();
  const [settings, setSettings] = useState<SettingsState>({
    hiragana: true,
    katakana: true,
    kanji: true,
    soundEnabled: loadStoredSoundEnabled(),
    hapticsEnabled: loadStoredHapticsEnabled(),
  });
  const [customItems, setCustomItems] = useState<CardItem[]>(DEFAULT_KANJI);
  const audioContextRef = useRef<AudioContext | null>(null);
  const hapticsSupported = useMemo(() => isLikelyHapticsSupported(), []);
  
  // Stats map: { [id]: { r2k: { gotIt, missed, streak }, k2r: { gotIt, missed, streak } } }
  const [stats, setStats] = useState<StatsMap>(() => loadStoredStats());

  const allItems = useMemo<CardItem[]>(() => {
    return [
      ...HIRAGANA,
      ...KATAKANA,
      ...customItems
    ];
  }, [customItems]);

  const activePool = useMemo<CardItem[]>(() => {
    const pool: CardItem[] = [];
    if (settings.hiragana) pool.push(...HIRAGANA);
    if (settings.katakana) pool.push(...KATAKANA);
    if (settings.kanji) pool.push(...customItems);
    return pool;
  }, [settings, customItems]);

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
      window.localStorage.setItem(SOUND_SETTINGS_KEY, String(settings.soundEnabled));
    } catch {
      // Ignore storage write failures so sound preferences stay optional.
    }
  }, [settings.soundEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(HAPTICS_SETTINGS_KEY, String(settings.hapticsEnabled));
    } catch {
      // Ignore storage write failures so haptic preferences stay optional.
    }
  }, [settings.hapticsEnabled]);

  const practiceSessionProps: PracticeSessionComponentProps = {
    activePool,
    stats,
    onUpdateStats: updateStats,
    onPlaySound: playFeedbackSound,
    onTriggerHaptics: triggerHaptics,
  };

  return (
    <div className="app-shell flex flex-col max-w-2xl mx-auto bg-[#09090b] text-zinc-100 font-sans selection:bg-emerald-500/30 overflow-hidden relative shadow-2xl">
      
      {/* Header (optional, clean minimal bar) */}
      <div className="h-14 flex items-center justify-center border-b border-zinc-900 bg-zinc-950/80 backdrop-blur-md z-10 shrink-0">
         <h1 className="font-bold text-lg tracking-wide text-zinc-100">NIHONGO<span className="text-emerald-500">FLASH</span></h1>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col bg-[#09090b]">
        {activePage === 'write' && (
          <WritePage PracticeSessionComponent={PracticeSession} sessionProps={practiceSessionProps} />
        )}
        {activePage === 'home' && (
          <HomePage PracticeSessionComponent={PracticeSession} sessionProps={practiceSessionProps} />
        )}
        {activePage === 'stats' && (
          <StatsPage StatsViewComponent={StatsView} stats={stats} allItems={allItems} />
        )}
        {activePage === 'settings' && (
          <SettingsPage
            SettingsViewComponent={SettingsView}
            settings={settings}
            setSettings={setSettings}
            customItems={customItems}
            setCustomItems={setCustomItems}
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
