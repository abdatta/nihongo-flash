import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './appConstants';
import { filterActiveCharacterPoolByReading } from './App';
import type { CardItem, SettingsState } from './types';

const makeSettings = (overrides: Partial<SettingsState> = {}): SettingsState => ({
  ...DEFAULT_SETTINGS,
  ...overrides,
});

const makeKanji = (
  id: string,
  readingType: 'onyomi' | 'kunyomi',
): CardItem => ({
  id,
  char: '日',
  romaji: id,
  type: 'kanji',
  readingType,
});

describe('filterActiveCharacterPoolByReading', () => {
  it('keeps both onyomi and kunyomi cards when both reading filters are enabled', () => {
    const cards: CardItem[] = [
      makeKanji('n5_hi_day', 'kunyomi'),
      makeKanji('n5_nichi_day', 'onyomi'),
    ];

    const filtered = filterActiveCharacterPoolByReading(cards, makeSettings({
      showOnyomi: true,
      showKunyomi: true,
    }));

    expect(filtered.map(card => card.id)).toEqual(['n5_hi_day', 'n5_nichi_day']);
  });

  it('keeps only onyomi kanji when kunyomi is disabled', () => {
    const cards: CardItem[] = [
      makeKanji('n5_hi_day', 'kunyomi'),
      makeKanji('n5_nichi_day', 'onyomi'),
    ];

    const filtered = filterActiveCharacterPoolByReading(cards, makeSettings({
      showOnyomi: true,
      showKunyomi: false,
    }));

    expect(filtered.map(card => card.id)).toEqual(['n5_nichi_day']);
  });

  it('keeps only kunyomi kanji when onyomi is disabled', () => {
    const cards: CardItem[] = [
      makeKanji('n5_hi_day', 'kunyomi'),
      makeKanji('n5_nichi_day', 'onyomi'),
    ];

    const filtered = filterActiveCharacterPoolByReading(cards, makeSettings({
      showOnyomi: false,
      showKunyomi: true,
    }));

    expect(filtered.map(card => card.id)).toEqual(['n5_hi_day']);
  });

  it('does not filter out cards without reading metadata', () => {
    const cards: CardItem[] = [
      { id: 'h_a', char: 'あ', romaji: 'a', type: 'hiragana' },
      { id: 'custom_1', char: '駅', romaji: 'eki', type: 'kanji' },
      makeKanji('n5_nichi_day', 'onyomi'),
    ];

    const filtered = filterActiveCharacterPoolByReading(cards, makeSettings({
      showOnyomi: false,
      showKunyomi: false,
    }));

    expect(filtered.map(card => card.id)).toEqual(['h_a', 'custom_1']);
  });
});
