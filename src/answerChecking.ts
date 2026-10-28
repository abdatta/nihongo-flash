import { toHiragana, toKana, toKatakana } from 'wanakana';
import type { CardItem } from './types';

// Keep vowel length and small kana significant, while accepting either script,
// spacing/punctuation differences, and WanaKana's supported romaji spellings.
const cleanAnswer = (value: string): string => value.normalize('NFKC').toLowerCase()
  .replace(/[āâ]/g, 'aa').replace(/[īî]/g, 'ii').replace(/[ūû]/g, 'uu')
  .replace(/[ēê]/g, 'ee').replace(/[ōô]/g, 'ou')
  .replace(/[\s.,!?。、？！・~〜～-]/g, '');

export const normalizeReadingAnswer = (value: string): string => toHiragana(toKatakana(toKana(cleanAnswer(value))));

export const isWordAnswerCorrect = (card: CardItem, response: string): boolean => {
  const answer = normalizeReadingAnswer(response);
  if (!answer) return false;
  const isJapanese = (value: string) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);
  // Standard foreign-word spellings such as "paatii" do not always round-trip
  // through WanaKana. Compare explicit romaji directly, without allowing its
  // transliteration to turn incorrect Japanese input into a correct answer.
  if (!isJapanese(response) && [card.romaji, ...(card.acceptedAnswers ?? []).filter(value => !isJapanese(value))]
    .some(value => cleanAnswer(value) === cleanAnswer(response))) return true;
  return [card.kana ?? toKana(card.romaji), card.char, ...(card.acceptedAnswers ?? []).filter(isJapanese)]
    .filter((value): value is string => !!value)
    .some(value => normalizeReadingAnswer(value) === answer);
};
