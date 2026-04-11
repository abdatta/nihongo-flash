import rawStudyData from './studyData.json';
import frequencyMap from './studyFrequencies.json';
import type { CardItem, SettingsState } from './types';

interface StudyDataShape {
  baseHiragana: CardItem[];
  hiraganaDakuten: CardItem[];
  hiraganaHandakuten: CardItem[];
  hiraganaYoon: CardItem[];
  baseKatakana: CardItem[];
  katakanaDakuten: CardItem[];
  katakanaHandakuten: CardItem[];
  katakanaYoon: CardItem[];
  jlptN5Kanji: CardItem[];
  defaultWords: CardItem[];
}

// Study items are the source of truth for kanji reading metadata.
// Keeping readingType/readingRange on the card itself avoids split-brain data as we add N4/N3 decks.
const typedStudyData = rawStudyData as StudyDataShape;
const typedFrequencyMap = frequencyMap as Record<string, number>;

const fallbackFrequencyByCharacter = new Map<string, number>();

typedStudyData.jlptN5Kanji.forEach((card) => {
  const existingFrequency = typedFrequencyMap[card.id];
  if (typeof existingFrequency !== 'number') {
    return;
  }

  const characterKey = `${card.type}::${card.char}`;
  if (!fallbackFrequencyByCharacter.has(characterKey)) {
    fallbackFrequencyByCharacter.set(characterKey, existingFrequency);
  }
});

const applyFrequencies = (cards: CardItem[]): CardItem[] => cards.map(card => ({
  ...card,
  ...(() => {
    const explicitFrequency = typedFrequencyMap[card.id];
    if (typeof explicitFrequency === 'number') {
      return { frequency: explicitFrequency };
    }

    const fallbackFrequency = fallbackFrequencyByCharacter.get(`${card.type}::${card.char}`);
    return typeof fallbackFrequency === 'number' ? { frequency: fallbackFrequency } : {};
  })(),
}));

export const BASE_HIRAGANA: CardItem[] = applyFrequencies(typedStudyData.baseHiragana);
export const HIRAGANA_DAKUTEN: CardItem[] = applyFrequencies(typedStudyData.hiraganaDakuten);
export const HIRAGANA_HANDAKUTEN: CardItem[] = applyFrequencies(typedStudyData.hiraganaHandakuten);
export const HIRAGANA_YOON: CardItem[] = applyFrequencies(typedStudyData.hiraganaYoon);

export const HIRAGANA: CardItem[] = [
  ...BASE_HIRAGANA,
  ...HIRAGANA_DAKUTEN,
  ...HIRAGANA_HANDAKUTEN,
  ...HIRAGANA_YOON,
];

export const BASE_KATAKANA: CardItem[] = applyFrequencies(typedStudyData.baseKatakana);
export const KATAKANA_DAKUTEN: CardItem[] = applyFrequencies(typedStudyData.katakanaDakuten);
export const KATAKANA_HANDAKUTEN: CardItem[] = applyFrequencies(typedStudyData.katakanaHandakuten);
export const KATAKANA_YOON: CardItem[] = applyFrequencies(typedStudyData.katakanaYoon);

export const KATAKANA: CardItem[] = [
  ...BASE_KATAKANA,
  ...KATAKANA_DAKUTEN,
  ...KATAKANA_HANDAKUTEN,
  ...KATAKANA_YOON,
];

export const JLPT_N5_KANJI: CardItem[] = applyFrequencies(typedStudyData.jlptN5Kanji);
export const DEFAULT_WORDS: CardItem[] = applyFrequencies(typedStudyData.defaultWords);

export const getEnabledHiraganaCards = (settings: SettingsState): CardItem[] => {
  const cards = [...BASE_HIRAGANA];

  if (settings.dakuten) cards.push(...HIRAGANA_DAKUTEN);
  if (settings.handakuten) cards.push(...HIRAGANA_HANDAKUTEN);
  if (settings.yoon) cards.push(...HIRAGANA_YOON);

  return cards;
};

export const getEnabledKatakanaCards = (settings: SettingsState): CardItem[] => {
  const cards = [...BASE_KATAKANA];

  if (settings.dakuten) cards.push(...KATAKANA_DAKUTEN);
  if (settings.handakuten) cards.push(...KATAKANA_HANDAKUTEN);
  if (settings.yoon) cards.push(...KATAKANA_YOON);

  return cards;
};
