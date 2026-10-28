import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStoredSettings, normalizeStoredCardItems } from './appPersistence';
import { SETTINGS_STORAGE_KEY } from './storageKeys';
import type { CardItem } from './types';

describe('normalizeStoredCardItems', () => {
  it('hydrates fallback frequency when stored built-in items are missing it', () => {
    const fallbackItems: CardItem[] = [
      { id: 'w_mizu', char: '水', romaji: 'mizu', type: 'word', studyMode: 'words', meanings: ['water'], frequency: 23525 },
    ];

    const normalized = normalizeStoredCardItems(
      [{ id: 'w_mizu', char: '水', romaji: 'MIZU', type: 'word', meanings: ['water'] }],
      fallbackItems,
      'words',
      'word',
    );

    expect(normalized).toEqual([
      { id: 'w_mizu', char: '水', romaji: 'mizu', type: 'word', studyMode: 'words', meanings: ['water'], frequency: 23525 },
    ]);
  });

  it('preserves an explicit stored frequency over the fallback value', () => {
    const fallbackItems: CardItem[] = [
      { id: 'w_mizu', char: '水', romaji: 'mizu', type: 'word', studyMode: 'words', meanings: ['water'], frequency: 23525 },
    ];

    const normalized = normalizeStoredCardItems(
      [{ id: 'w_mizu', char: '水', romaji: 'mizu', type: 'word', meanings: ['water'], frequency: 999 }],
      fallbackItems,
      'words',
      'word',
    );

    expect(normalized[0]?.frequency).toBe(999);
  });

  it('does not invent a frequency for custom items without fallback data', () => {
    const normalized = normalizeStoredCardItems(
      [{ id: 'word_1', char: '助けて', romaji: 'tasukete', type: 'word', meanings: ['help me'] }],
      [],
      'words',
      'word',
    );

    expect(normalized[0]).not.toHaveProperty('frequency');
  });
});

describe('loadStoredSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a new user with Tobira Lesson 0 available in Words', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    expect(loadStoredSettings().wordSource).toBe('tobira');
    expect(loadStoredSettings().wordLessons).toEqual([0]);
  });

  it('defaults reading filters to enabled when they are missing from older saved settings', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => (key === SETTINGS_STORAGE_KEY ? JSON.stringify({ jlptN5Kanji: true }) : null),
      },
    });

    const settings = loadStoredSettings();

    expect(settings.jlptN5Kanji).toBe(true);
    expect(settings.showOnyomi).toBe(true);
    expect(settings.showKunyomi).toBe(true);
  });

  it('hydrates stored reading filter preferences when present', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => (
          key === SETTINGS_STORAGE_KEY
            ? JSON.stringify({ showOnyomi: false, showKunyomi: true })
            : null
        ),
      },
    });

    const settings = loadStoredSettings();

    expect(settings.showOnyomi).toBe(false);
    expect(settings.showKunyomi).toBe(true);
  });

  it('migrates shared kana switches into independent script settings without changing personal words', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({ dakuten: true, handakuten: false, yoon: true, studyMode: 'words' }) } });
    const settings = loadStoredSettings();
    expect(settings.hiraganaOptions).toEqual({ basic: true, dakuten: true, handakuten: false, yoon: true });
    expect(settings.katakanaOptions).toEqual(settings.hiraganaOptions);
    expect(settings.katakanaOptions).not.toBe(settings.hiraganaOptions);
    expect(settings.wordSource).toBe('personal');
  });

  it('restores independent scripts and mode-specific lesson selections', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({
      wordSource: 'tobira', wordLessons: [2], characterLessons: [3, 4], mixCharacterLessons: true,
      wordGroups: ['verbs'], hiraganaOptions: { basic: false, handakuten: true }, katakanaOptions: { basic: true, dakuten: true },
    }) } });
    const settings = loadStoredSettings();
    expect(settings.wordLessons).toEqual([2]);
    expect(settings.characterLessons).toEqual([3, 4]);
    expect(settings.wordGroups).toEqual(['verbs']);
    expect(settings.hiraganaOptions.basic).toBe(false);
    expect(settings.katakanaOptions.basic).toBe(true);
    expect(settings.katakanaOptions.dakuten).toBe(true);
  });

  it('normalizes invalid and duplicate lessons and only restores multiple lessons when mixing is enabled', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => JSON.stringify({ wordLessons: [2, 2, 1, -1, '0', null], mixWordLessons: false }) } });
    expect(loadStoredSettings().wordLessons).toEqual([2]);
  });

  it('restores later textbook sets independently for vocabulary and kanji', () => {
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => key === SETTINGS_STORAGE_KEY ? JSON.stringify({
      wordSource: 'tobira', wordLessons: [8, 10, 10, 11], mixWordLessons: true,
      tobiraKanji: true, characterLessons: [9], mixCharacterLessons: false,
    }) : null } });
    const settings = loadStoredSettings();
    expect(settings.wordLessons).toEqual([8, 10]);
    expect(settings.characterLessons).toEqual([9]);
    expect(settings.tobiraKanji).toBe(true);
  });
});
