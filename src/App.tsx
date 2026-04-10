import React, { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { Settings, BarChart2, Edit3, BookOpen, Check, X, RefreshCw, Plus, Trash2, ArrowRight } from 'lucide-react';
import { toKana } from 'wanakana';
import RecognizePage from './pages/RecognizePage';
import RecallPage from './pages/RecallPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';
import { DAY_IN_MS, DEFAULT_EASE, MIN_EASE, MIN_RECENT_REVIEWS_FOR_STRONG, RECENT_RESULTS_LIMIT } from './appConstants';
import { buildLocalStorageExport, createEmptyDirectionStats, loadStoredCardItems, loadStoredSettings, loadStoredStats } from './appPersistence';
import { useActivePage, useViewportHeightVar } from './appShell';
import type {
  CardItem,
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
  CUSTOM_ITEMS_STORAGE_KEY,
  HAPTICS_SETTINGS_KEY,
  SETTINGS_STORAGE_KEY,
  SOUND_SETTINGS_KEY,
  STATS_STORAGE_KEY,
  STUDY_MODE_STORAGE_KEY,
  WORD_ITEMS_STORAGE_KEY,
} from './storageKeys';
import {
  BASE_HIRAGANA,
  BASE_KATAKANA,
  DEFAULT_WORDS,
  HIRAGANA_DAKUTEN,
  HIRAGANA_HANDAKUTEN,
  HIRAGANA_YOON,
  JLPT_N5_KANJI,
  KATAKANA_DAKUTEN,
  KATAKANA_HANDAKUTEN,
  KATAKANA_YOON,
  getEnabledHiraganaCards,
  getEnabledKatakanaCards,
} from './studyData';
import {
  buildAdaptiveQueueFromRankedEntries,
  buildExperimentalQueueFromBuckets,
  pickRandomCards,
  shuffleCards,
} from './deckBuilder';
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

const getCardStudyMode = (card: CardItem): StudyMode => (
  card.studyMode ?? (card.type === 'word' ? 'words' : 'characters')
);

const getItemIdentityKey = (card: CardItem): string => `${getCardStudyMode(card)}::${card.char}::${card.romaji}`;

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

const buildExperimentalQueue = (
  activePool: CardItem[],
  stats: StatsMap,
  direction: Direction,
  sessionSize = 15,
): CardItem[] => {
  if (activePool.length <= sessionSize) {
    return shuffleCards(activePool);
  }

  const buckets = activePool.reduce<Record<StrengthMeta['bucket'], CardItem[]>>((acc, card) => {
    const directionStats = getScheduledDirectionStats(stats, card.id, direction);
    const { bucket } = getCardStrengthMeta(directionStats);
    acc[bucket].push(card);
    return acc;
  }, {
    new: [],
    weak: [],
    improving: [],
    strong: [],
  });

  return buildExperimentalQueueFromBuckets(buckets, sessionSize);
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

  return buildAdaptiveQueueFromRankedEntries(
    rankedCards,
    entry => getCardStrengthMeta(entry.directionStats).bucket,
    sessionSize,
  );
};

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

interface FlashcardShellProps {
  type: CardType;
  assessedState: ReviewResult | null;
  revealed: boolean;
  padded?: boolean;
  fixedHeight?: boolean;
  children: ReactNode;
}

interface FlashcardBadgesProps {
  type: CardType;
  strengthClasses: string;
  strengthLabel: string;
  className?: string;
}

interface RevealButtonProps {
  onClick: () => void;
}

interface AssessmentActionsProps {
  assessedState: ReviewResult | null;
  onMissed: () => void;
  onGotIt: () => void;
  className?: string;
  missedWidthClass?: string;
  showGotIt?: boolean;
}

const FlashcardShell = ({
  type,
  assessedState,
  revealed,
  padded = true,
  fixedHeight = false,
  children,
}: FlashcardShellProps) => {
  const paddingClass = padded ? 'p-8' : 'p-6';
  const heightClass = fixedHeight ? ' min-h-[340px]' : '';

  return (
    <div className={`flex flex-col w-full max-w-sm mx-auto border ${getCardThemeClasses(type, assessedState, revealed)} rounded-3xl ${paddingClass} shadow-2xl transition-all duration-300 relative overflow-hidden${heightClass}`}>
      {children}
    </div>
  );
};

const FlashcardBadges = ({
  type,
  strengthClasses,
  strengthLabel,
  className = '',
}: FlashcardBadgesProps) => (
  <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`.trim()}>
    <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${getTypeBadgeClasses(type)}`}>
      {type === 'word' ? 'words' : type}
    </span>
    <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-widest uppercase ${strengthClasses}`}>
      {strengthLabel}
    </span>
  </div>
);

const RevealButton = ({ onClick }: RevealButtonProps) => (
  <button
    onClick={onClick}
    className="w-full rounded-xl bg-zinc-100 py-4 text-lg font-bold text-zinc-950 shadow-md transition-colors hover:bg-zinc-200"
  >
    Reveal
  </button>
);

const AssessmentActions = ({
  assessedState,
  onMissed,
  onGotIt,
  className = '',
  missedWidthClass = 'flex-1',
  showGotIt = true,
}: AssessmentActionsProps) => (
  <div className={`flex gap-3 ${className}`.trim()}>
    <button
      onClick={onMissed}
      disabled={!!assessedState}
      className={`${missedWidthClass} flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-colors ${assessedState === 'missed' ? 'bg-rose-500 text-white' : 'bg-zinc-900 text-rose-400 hover:bg-rose-500/20'}`}
    >
      <X size={20} /> Missed
    </button>
    {showGotIt && (
      <button
        onClick={onGotIt}
        disabled={!!assessedState}
        className={`flex-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-colors ${assessedState === 'gotIt' ? 'bg-emerald-500 text-white' : 'bg-zinc-900 text-emerald-400 hover:bg-emerald-500/20'}`}
      >
        <Check size={20} /> Got it
      </button>
    )}
  </div>
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
      <FlashcardShell type="word" assessedState={assessedState} revealed={revealed} padded={false}>
        <FlashcardBadges type="word" strengthClasses={strengthMeta.classes} strengthLabel={strengthMeta.label} className="mb-5" />
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
      </FlashcardShell>
    );
  }

  if (studyMode === 'words') {
    return (
      <FlashcardShell type="word" assessedState={assessedState} revealed={revealed} fixedHeight>
        <div className="text-center flex-1 flex flex-col items-center">
          <FlashcardBadges type="word" strengthClasses={strengthMeta.classes} strengthLabel={strengthMeta.label} />
          <div className="flex min-h-[176px] w-full flex-1 items-center justify-center">
            {!revealed ? (
              <div className="flex flex-col items-center justify-center text-center">
                <h2 className="text-6xl font-bold text-zinc-100 leading-none">{card.char}</h2>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center animate-in fade-in duration-300">
                <h2 className="text-5xl font-bold text-zinc-100 leading-none">{card.char}</h2>
                <p className="mt-5 text-2xl font-semibold text-emerald-300">{card.romaji}</p>
                <p className="mt-4 text-base text-zinc-300">{meaningsText}</p>
              </div>
            )}
          </div>
        </div>
        <div>
          {!revealed ? (
            <RevealButton onClick={handleReveal} />
          ) : (
            <AssessmentActions
              assessedState={assessedState}
              onMissed={() => handleAssess('missed')}
              onGotIt={() => handleAssess('gotIt')}
              className="animate-in fade-in duration-300"
            />
          )}
        </div>
      </FlashcardShell>
    );
  }

  // Specific rendering for Romaji -> Kana (includes drawing pad)
  if (direction === 'r2k') {
    return (
      <FlashcardShell type={card.type} assessedState={assessedState} revealed={revealed} padded={false}>
        <div className="text-center mb-4 flex flex-col items-center min-h-[110px] justify-end">
          <FlashcardBadges type={card.type} strengthClasses={strengthMeta.classes} strengthLabel={strengthMeta.label} className="mb-auto" />
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
          <RevealButton onClick={handleReveal} />
        ) : (
          <AssessmentActions
            assessedState={assessedState}
            onMissed={() => handleAssess('missed')}
            onGotIt={() => handleAssess('gotIt')}
            className="animate-in slide-in-from-bottom-4 duration-300"
            missedWidthClass={hadDrawingOnReveal ? 'flex-1' : 'w-full'}
            showGotIt={hadDrawingOnReveal}
          />
        )}
      </FlashcardShell>
    );
  }

  // Specific rendering for Kana -> Romaji (simple flip)
  return (
    <FlashcardShell type={card.type} assessedState={assessedState} revealed={revealed} fixedHeight>
        <div className="text-center flex-1 flex flex-col items-center">
          <FlashcardBadges type={card.type} strengthClasses={strengthMeta.classes} strengthLabel={strengthMeta.label} />

          <div className="flex min-h-[176px] w-full flex-1 items-center justify-center">
            {!revealed ? (
              <div className="flex items-center justify-center text-center">
                <h2 className="text-8xl font-bold text-zinc-100 leading-none">{promptText}</h2>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center animate-in fade-in duration-300">
                <h2 className="text-5xl font-bold text-zinc-100 leading-none">{promptText}</h2>
                <p className="mt-5 text-4xl font-semibold text-emerald-300">{answerText}</p>
                {meaningsText && (
                  <p className="mt-4 text-center text-sm text-zinc-400">{meaningsText}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div>
          {!revealed ? (
            <RevealButton onClick={handleReveal} />
          ) : (
            <AssessmentActions
              assessedState={assessedState}
              onMissed={() => handleAssess('missed')}
              onGotIt={() => handleAssess('gotIt')}
              className="animate-in fade-in duration-300"
            />
          )}
        </div>
    </FlashcardShell>
  );
};

const PracticeSession = ({
  activePool,
  studyMode,
  direction,
  stats,
  experimentalDeckBuilderEnabled,
  onUpdateStats,
  onPlaySound,
  onTriggerHaptics,
}: PracticeSessionProps) => {
  const [queue, setQueue] = useState<CardItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionActive, setSessionActive] = useState(() => activePool.length > 0);

  const startSession = useCallback(() => {
    setQueue(
      experimentalDeckBuilderEnabled
        ? buildExperimentalQueue(activePool, stats, direction, 15)
        : buildAdaptiveQueue(activePool, stats, direction, 15),
    );
    setCurrentIndex(0);
    setSessionActive(true);
  }, [activePool, stats, direction, experimentalDeckBuilderEnabled]);

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

const StatsView = ({
  stats,
  allItems,
  activePool,
  studyMode,
  onResetStatCategory,
  onResetStatItem,
}: StatsViewProps) => {
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

  const getVisibleItemIds = useCallback((item: AnalyzedStatItem | CardItem): string[] => (
    'groupItems' in item ? item.groupItems.map(groupItem => groupItem.id) : [item.id]
  ), []);

  const handleResetCategory = useCallback((title: string, items: AnalyzedStatItem[]) => {
    if (items.length === 0) {
      return;
    }

    const message = `Reset ${items.length} ${items.length === 1 ? 'item' : 'items'} in ${title} for this tab?`;
    if (typeof window !== 'undefined' && !window.confirm(message)) {
      return;
    }

    const cardIds = Array.from(new Set(items.flatMap(item => getVisibleItemIds(item))));
    onResetStatCategory(cardIds, activeStatsTab);
    setSelectedItem(current => (
      current && cardIds.includes(current.id) ? null : current
    ));
  }, [activeStatsTab, getVisibleItemIds, onResetStatCategory]);

  const handleResetSelectedItem = useCallback(() => {
    if (!selectedItem || !('ratio' in selectedItem)) {
      return;
    }

    const message = `Reset ${selectedItem.char} for this tab back to new?`;
    if (typeof window !== 'undefined' && !window.confirm(message)) {
      return;
    }

    onResetStatItem(getVisibleItemIds(selectedItem), activeStatsTab);
    setSelectedItem(null);
  }, [activeStatsTab, getVisibleItemIds, onResetStatItem, selectedItem]);

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
        <div className="flex items-center gap-3">
          <h3 className="text-2xl font-bold text-zinc-100">{title}</h3>
          <button
            type="button"
            onClick={() => handleResetCategory(title, items)}
            disabled={items.length === 0}
            className="rounded-full border border-rose-500/30 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-rose-300 transition-colors hover:border-rose-400/50 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent"
          >
            Reset
          </button>
        </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <button type="button" aria-label="Close item details" className="absolute inset-0 cursor-default" onClick={() => setSelectedItem(null)} />
          <div className="relative z-10 max-h-[calc(var(--app-height,100vh)-2rem)] w-full max-w-md overflow-y-auto rounded-[2rem] border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
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
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Streak</p>
                    <p className="mt-2 text-2xl font-bold text-zinc-100">{selectedItem.streak}</p>
                  </div>
                </div>
              </div>
            ) : null}

            {typeof selectedItem.frequency === 'number' && Number.isFinite(selectedItem.frequency) ? (
              <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-zinc-500">Frequency in Language</p>
                <p className="mt-2 text-2xl font-bold text-zinc-100">{selectedItem.frequency.toLocaleString()}</p>
              </div>
            ) : null}

            {'ratio' in selectedItem ? (
              <button
                type="button"
                onClick={handleResetSelectedItem}
                className="mt-3 w-full rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-200 transition-colors hover:border-rose-400/50 hover:bg-rose-500/15"
              >
                Reset This {studyMode === 'words' ? 'Word' : 'Character'}
              </button>
            ) : null}
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
        <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4 ml-2">Practice</h3>
        <Toggle
          label="Experimental Deck Builder"
          checked={settings.experimentalDeckBuilderEnabled}
          onChange={(val) => setSettings(s => ({ ...s, experimentalDeckBuilderEnabled: val }))}
        />
        <p className="mt-2 ml-2 text-sm text-zinc-500">Mix 3 strong cards with 12 non-strong ones, preferring weak and improving items before new cards.</p>
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
  const [customItems, setCustomItems] = useState<CardItem[]>(() => loadStoredCardItems(CUSTOM_ITEMS_STORAGE_KEY, [], 'characters', 'kanji'));
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
  }, [customItems, settings.studyMode, wordItems]);

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

  const resetStatsForDirection = useCallback((cardIds: string[], direction: Direction) => {
    if (cardIds.length === 0) {
      return;
    }

    setStats(prev => {
      const nextStats = { ...prev };

      cardIds.forEach(cardId => {
        const existingCardStats = nextStats[cardId];
        if (!existingCardStats || !existingCardStats[direction]) {
          return;
        }

        const { [direction]: _removedDirection, ...remainingDirections } = existingCardStats;
        if (Object.keys(remainingDirections).length === 0) {
          delete nextStats[cardId];
          return;
        }

        nextStats[cardId] = remainingDirections;
      });

      return nextStats;
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
    experimentalDeckBuilderEnabled: settings.experimentalDeckBuilderEnabled,
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
          <StatsPage
            StatsViewComponent={StatsView}
            stats={stats}
            allItems={allItems}
            activePool={activePool}
            studyMode={settings.studyMode}
            onResetStatCategory={resetStatsForDirection}
            onResetStatItem={resetStatsForDirection}
          />
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

