import { HIRAGANA, KATAKANA, JLPT_N5_KANJI, TOBIRA_KANJI, TOBIRA_WORDS, getEnabledHiraganaCards, getEnabledKatakanaCards } from './studyData';
import type { CardItem, SettingsState, StudySetDefinition } from './types';

export const TOBIRA_COLLECTION_ID = 'tobira-1';
export const TOBIRA_SETS: StudySetDefinition[] = [
  { id: 0, label: 'L0', description: 'Getting started', referencePages: '15–20' },
  { id: 1, label: 'L1', description: 'Self-introduction', referencePages: '34–37' },
  { id: 2, label: 'L2', description: 'Weekend plans', referencePages: '56–59' },
  { id: 3, label: 'L3', description: 'Family & past events', referencePages: '90–93' },
  { id: 4, label: 'L4', description: 'Shopping & describing things', referencePages: '122–126' },
  { id: 5, label: 'L5', description: 'Places & possessions', referencePages: '156–160' },
  { id: 6, label: 'L6', description: 'Actions & appearances', referencePages: '192–196' },
  { id: 7, label: 'L7', description: 'Gifts & things you want', referencePages: '224–228' },
  { id: 8, label: 'L8', description: 'Skills, plans & favors', referencePages: '264–268' },
  { id: 9, label: 'L9', description: 'Weather, health & experiences', referencePages: '302–306' },
  { id: 10, label: 'L10', description: 'Comparisons & changes', referencePages: '340–344' },
];

// Characters introduced in each lesson, including the five kanji-as-elements.
// The study cards use the book's words/readings rather than every dictionary reading.
export const TOBIRA_KANJI_TARGETS: Record<number, string> = {
  3: '一二三四五六七八九十月私子人',
  4: '百千万円曜日火水木金土学生先年大小',
  5: '上下中外右左山川寺何時間毎明今田町花',
  6: '食飲言話行来見持本語体口目耳手足週回',
  7: '会聞読立住知入売買物音楽海国門矢貝牛',
  8: '男女好作出書分午前後有名父母兄弟姉妹',
  9: '思休悪新古高校雨雪晴度天気元病英家心',
  10: '帰使暗早広安親切番社長道昔友達文化末',
};

export const GROUP_LABELS: Record<string, string> = {
  greetings: 'Greetings', expressions: 'Expressions', classroom: 'Classroom',
  nouns: 'Nouns', verbs: 'Verbs', numbers: 'Numbers', counters: 'Counters & suffixes',
  questions: 'Question words', time: 'Time & days', adverbs: 'Adverbs', conjunctions: 'Connecting words',
  'i-adjectives': 'い-adjectives', 'na-adjectives': 'な-adjectives',
  demonstratives: 'Demonstratives', locations: 'Locations',
};

export const uniqueCards = (cards: CardItem[]): CardItem[] => [...new Map(cards.map(card => [card.id, card])).values()];

export const filterCollection = (cards: CardItem[], collectionId: string, lessons: number[], groups: string[] = []): CardItem[] => (
  uniqueCards(cards.filter(card => card.memberships?.some(membership => (
    membership.collectionId === collectionId && lessons.includes(membership.lesson)
    && (groups.length === 0 || (typeof membership.group === 'string' && groups.includes(membership.group)))
  ))))
);

export const getCollectionCategories = (cards: CardItem[], collectionId: string, setIds: number[]): string[] => [...new Set(cards.flatMap(card => (
  card.memberships?.filter(m => m.collectionId === collectionId && setIds.includes(m.lesson))
    .map(m => m.group).filter((group): group is string => typeof group === 'string' && group.trim().length > 0) ?? []
)))];

export const getWordGroups = (setIds: number[]): string[] => getCollectionCategories(TOBIRA_WORDS, TOBIRA_COLLECTION_ID, setIds);

export const getAvailableCharacterPool = (settings: SettingsState, customItems: CardItem[]): CardItem[] => {
  const pool: CardItem[] = [];
  if (settings.hiragana) pool.push(...getEnabledHiraganaCards(settings));
  if (settings.katakana) pool.push(...getEnabledKatakanaCards(settings));
  if (settings.jlptN5Kanji) pool.push(...JLPT_N5_KANJI);
  if (settings.kanji) pool.push(...customItems);
  if (settings.tobiraKanji) pool.push(...filterCollection(TOBIRA_KANJI, TOBIRA_COLLECTION_ID, settings.characterLessons));
  return uniqueCards(pool).map(card => ({ ...card, studyMode: 'characters' }));
};

export const getWordPool = (settings: SettingsState, personalWords: CardItem[]): CardItem[] => (
  (settings.wordSource === 'tobira'
    ? filterCollection(TOBIRA_WORDS, TOBIRA_COLLECTION_ID, settings.wordLessons, settings.wordGroups)
    : uniqueCards(personalWords)).map(card => ({ ...card, studyMode: 'words' }))
);

export const getAllItems = (settings: SettingsState, customItems: CardItem[], personalWords: CardItem[]): CardItem[] => (
  settings.studyMode === 'words'
    ? uniqueCards([...TOBIRA_WORDS, ...personalWords]).map(card => ({ ...card, studyMode: 'words' }))
    : uniqueCards([...HIRAGANA, ...KATAKANA, ...JLPT_N5_KANJI, ...TOBIRA_KANJI, ...customItems]).map(card => ({ ...card, studyMode: 'characters' }))
);

export const getScopeLabel = (settings: SettingsState): string => {
  if (settings.studyMode === 'words') {
    if (settings.wordSource === 'personal') return 'Words · Personal deck';
    const sets = settings.wordLessons.map(n => TOBIRA_SETS.find(set => set.id === n)?.label ?? `Set ${n}`).join(' + ') || 'No sets';
    const groups = settings.wordGroups.map(group => GROUP_LABELS[group] ?? group).join(', ');
    return `Words · Tobira I · ${sets}${groups ? ` · ${groups}` : ''}`;
  }
  const labels: string[] = [];
  const kanaLabel = (script: 'hiragana' | 'katakana') => {
    const options = script === 'hiragana' ? settings.hiraganaOptions : settings.katakanaOptions;
    const groups = Object.entries(options).filter(([, enabled]) => enabled).map(([name]) => name[0].toUpperCase() + name.slice(1));
    return `${script === 'hiragana' ? 'Hiragana' : 'Katakana'} (${groups.join(', ') || 'no groups'})`;
  };
  if (settings.hiragana) labels.push(kanaLabel('hiragana'));
  if (settings.katakana) labels.push(kanaLabel('katakana'));
  if (settings.tobiraKanji) labels.push(`Tobira I ${settings.characterLessons.map(n => `L${n}`).join(' + ')}`);
  if (settings.jlptN5Kanji) labels.push('JLPT N5 Kanji');
  if (settings.kanji) labels.push('Custom Kanji');
  return `Characters · ${labels.join(' + ') || 'No content selected'}`;
};
