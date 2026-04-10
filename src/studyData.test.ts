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
});
