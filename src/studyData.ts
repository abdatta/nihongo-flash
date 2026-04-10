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

const typedStudyData = rawStudyData as StudyDataShape;
const typedFrequencyMap = frequencyMap as Record<string, number>;

const applyFrequencies = (cards: CardItem[]): CardItem[] => cards.map(card => ({
  ...card,
  ...(typeof typedFrequencyMap[card.id] === 'number' ? { frequency: typedFrequencyMap[card.id] } : {}),
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
