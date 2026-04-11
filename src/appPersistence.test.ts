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
});
