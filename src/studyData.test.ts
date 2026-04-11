import { describe, expect, it } from 'vitest';
import studyFrequencies from './studyFrequencies.json';
import {
  BASE_HIRAGANA,
  DEFAULT_WORDS,
  JLPT_N5_KANJI,
} from './studyData';

describe('study data frequency wiring', () => {
  it('applies generated frequencies to built-in kana data', () => {
    const card = BASE_HIRAGANA.find(item => item.id === 'h_ki');

    expect(card?.frequency).toBe(studyFrequencies.h_ki);
  });

  it('applies generated frequencies to built-in word data', () => {
    const card = DEFAULT_WORDS.find(item => item.id === 'w_mizu');

    expect(card?.frequency).toBe(studyFrequencies.w_mizu);
  });

  it('keeps zero-valued generated frequencies instead of dropping them', () => {
    const card = DEFAULT_WORDS.find(item => item.id === 'w_tasukete');

    expect(studyFrequencies.w_tasukete).toBe(0);
    expect(card?.frequency).toBe(0);
  });

  it('applies frequencies to kanji data as well', () => {
    const card = JLPT_N5_KANJI.find(item => item.id === 'n5_mizu');

    expect(card?.frequency).toBe(studyFrequencies.n5_mizu);
  });

  it('keeps matching frequencies across alternate reading entries for the same kanji', () => {
    const existingCard = JLPT_N5_KANJI.find(item => item.id === 'n5_hi_day');
    const alternateCard = JLPT_N5_KANJI.find(item => item.id === 'n5_nichi_day');

    expect(existingCard?.frequency).toBe(studyFrequencies.n5_hi_day);
    expect(alternateCard?.frequency).toBe(studyFrequencies.n5_hi_day);
  });

  it('keeps kanji reading metadata on the card entries themselves', () => {
    JLPT_N5_KANJI.forEach((card) => {
      expect(card.readingType === 'onyomi' || card.readingType === 'kunyomi').toBe(true);

      if (!card.readingRange) {
        return;
      }

      expect(card.readingRange).toHaveLength(2);
      const [start, end] = card.readingRange;

      expect(Number.isInteger(start)).toBe(true);
      expect(Number.isInteger(end)).toBe(true);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(end).toBeLessThanOrEqual(card.romaji.length);
    });
  });

  it('keeps N5 kanji ids unique as alternate readings are added', () => {
    const ids = JLPT_N5_KANJI.map(card => card.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
