import { describe, expect, it } from 'vitest';
import { isWordAnswerCorrect } from './answerChecking';
import { TOBIRA_WORDS } from './studyData';

const word = (key: string) => {
  const card = TOBIRA_WORDS.find(item => item.char === key);
  if (!card) throw new Error(`Missing pilot card: ${key}`);
  return card;
};

describe('word answers', () => {
  it('accepts kana, romaji spelling variants and the textbook phonetic spelling', () => {
    for (const answer of ['せんせい', 'センセイ', 'sensei', 'sensee', 'ＳＥＮＳＥＩ']) {
      expect(isWordAnswerCorrect(word('せんせい'), answer), answer).toBe(true);
    }
    expect(isWordAnswerCorrect(word('しゅくだい'), 'syukudai')).toBe(true);
  });

  it('accepts listed alternate forms and optional particles', () => {
    expect(isWordAnswerCorrect(word('よん'), 'shi')).toBe(true);
    expect(isWordAnswerCorrect(word('べんきょうする'), 'べんきょうをする')).toBe(true);
    expect(isWordAnswerCorrect(word('アルバイトする'), 'baito wo suru')).toBe(true);
  });

  it('handles long-vowel marks in either script without accepting missing vowels', () => {
    for (const answer of ['コーヒー', 'こーひー', 'koohii', 'kōhī']) {
      expect(isWordAnswerCorrect(word('コーヒー'), answer), answer).toBe(true);
    }
    expect(isWordAnswerCorrect(word('コーヒー'), 'kohi')).toBe(false);
    expect(isWordAnswerCorrect(word('きょう'), 'kyo')).toBe(false);
  });

  it('ignores punctuation and spacing, but rejects empty and incorrect answers', () => {
    expect(isWordAnswerCorrect(word('おんがくがすきです'), 'ongaku ga suki desu.')).toBe(true);
    expect(isWordAnswerCorrect(word('おんがくがすきです'), '')).toBe(false);
    expect(isWordAnswerCorrect(word('おんがくがすきです'), 'すきです')).toBe(false);
  });

  it('accepts standard foreign-word romaji without accepting a different kana spelling', () => {
    expect(isWordAnswerCorrect(word('パーティー'), 'paatii')).toBe(true);
    expect(isWordAnswerCorrect(word('パーティー'), 'ぱーてぃー')).toBe(true);
    expect(isWordAnswerCorrect(word('パーティー'), 'ぱあちい')).toBe(false);
  });
});
