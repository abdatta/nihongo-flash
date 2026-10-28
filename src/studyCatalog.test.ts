import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './appConstants';
import { DEFAULT_WORDS, TOBIRA_KANJI, TOBIRA_WORDS } from './studyData';
import { filterCollection, getAvailableCharacterPool, getCollectionCategories, getWordPool, TOBIRA_COLLECTION_ID, TOBIRA_SETS, TOBIRA_KANJI_TARGETS } from './studyCatalog';
import type { CardItem } from './types';

describe('study scopes', () => {
  it('supports sets without categories and derives optional categories only from the selected collection and sets', () => {
    const cards: CardItem[] = [
      { id: 'plain', char: 'あ', romaji: 'a', type: 'word', memberships: [{ collectionId: 'custom', lesson: 7 }] },
      { id: 'categorized', char: 'いく', romaji: 'iku', type: 'word', memberships: [{ collectionId: 'custom', lesson: 8, group: 'verbs' }] },
      { id: 'other', char: 'ほん', romaji: 'hon', type: 'word', memberships: [{ collectionId: 'other', lesson: 7, group: 'nouns' }] },
    ];
    expect(getCollectionCategories(cards, 'custom', [7])).toEqual([]);
    expect(getCollectionCategories(cards, 'custom', [7, 8])).toEqual(['verbs']);
    expect(filterCollection(cards, 'custom', [7]).map(card => card.id)).toEqual(['plain']);
  });

  it('limits vocabulary to the selected lesson and never pulls in personal words', () => {
    const pool = getWordPool({ ...DEFAULT_SETTINGS, wordSource: 'tobira', wordLessons: [2] }, DEFAULT_WORDS);
    expect(pool).toHaveLength(94);
    expect(pool.every(card => card.memberships?.some(m => m.lesson === 2))).toBe(true);
    expect(pool.some(card => card.char === 'わたし')).toBe(false);
    expect(pool.some(card => card.char === 'たべる')).toBe(true);
  });

  it('deduplicates shared learning items when mixing lessons', () => {
    const pool = filterCollection(TOBIRA_WORDS, TOBIRA_COLLECTION_ID, [0, 1]);
    expect(pool.filter(card => card.char === 'せんせい')).toHaveLength(1);
    expect(pool.filter(card => card.char === 'そうですか')).toHaveLength(1);
    expect(new Set(pool.map(card => card.id)).size).toBe(pool.length);
  });

  it('keeps homophones with different meanings separate', () => {
    const pool = filterCollection(TOBIRA_WORDS, TOBIRA_COLLECTION_ID, [0, 1]);
    const san = pool.filter(card => card.char === 'さん');
    expect(san).toHaveLength(2);
    expect(san.map(card => card.meanings?.[0])).toContain('Three');
    expect(new Set(san.map(card => card.id)).size).toBe(2);
  });

  it('can focus on a subgroup without changing the lesson', () => {
    const pool = getWordPool({ ...DEFAULT_SETTINGS, wordLessons: [2], wordGroups: ['verbs'] }, DEFAULT_WORDS);
    expect(pool).toHaveLength(14);
    expect(pool.every(card => card.memberships?.some(m => m.lesson === 2 && m.group === 'verbs'))).toBe(true);
  });

  it('leaves personal words untouched and independent of textbook selections', () => {
    const pool = getWordPool({ ...DEFAULT_SETTINGS, wordSource: 'personal', wordLessons: [], wordGroups: ['verbs'] }, DEFAULT_WORDS);
    expect(pool.map(card => card.id)).toEqual(DEFAULT_WORDS.map(card => card.id));
  });

  it('allows variation-only practice separately for each script', () => {
    const pool = getAvailableCharacterPool({
      ...DEFAULT_SETTINGS,
      hiraganaOptions: { basic: false, dakuten: false, handakuten: true, yoon: false },
      katakanaOptions: { basic: true, dakuten: false, handakuten: false, yoon: false },
    }, []);
    expect(pool.filter(card => card.type === 'hiragana').map(card => card.char)).toEqual(['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ']);
    expect(pool.filter(card => card.type === 'katakana')).toHaveLength(46);
    expect(pool.some(card => card.char === 'ガ')).toBe(false);
  });
});

describe('Tobira I data', () => {
  it('has unique stable ids, complete readings and meanings, and valid textbook memberships', () => {
    const cards = [...TOBIRA_WORDS, ...TOBIRA_KANJI];
    expect(new Set(cards.map(card => card.id)).size).toBe(cards.length);
    cards.forEach(card => {
      expect(card.kana).toBeTruthy();
      expect(card.meanings?.length).toBeGreaterThan(0);
      expect(card.romaji).toBe(card.romaji.toLowerCase());
      expect(card.memberships?.length).toBeGreaterThan(0);
      expect(card.memberships?.every(m => m.collectionId === TOBIRA_COLLECTION_ID && TOBIRA_SETS.some(set => set.id === m.lesson))).toBe(true);
      expect(card.char).not.toContain('\uFFFD');
    });
  });

  it('covers every vocabulary set and all 139 introduced kanji in their own lessons', () => {
    expect(TOBIRA_SETS.map(set => set.id)).toEqual(Array.from({ length: 11 }, (_, n) => n));
    expect(TOBIRA_SETS.map(set => filterCollection(TOBIRA_WORDS, TOBIRA_COLLECTION_ID, [set.id]).length))
      .toEqual([51, 93, 94, 105, 93, 90, 93, 71, 79, 71, 73]);
    expect(Object.values(TOBIRA_KANJI_TARGETS).join('')).toHaveLength(139);
    Object.entries(TOBIRA_KANJI_TARGETS).forEach(([lesson, targets]) => {
      const pool = getAvailableCharacterPool({ ...DEFAULT_SETTINGS, hiragana: false, katakana: false, tobiraKanji: true, characterLessons: [Number(lesson)] }, []);
      const writtenForms = pool.map(card => card.char).join('');
      for (const kanji of targets) expect(writtenForms, `L${lesson} needs ${kanji}`).toContain(kanji);
      expect(pool.every(card => card.type === 'kanji' && card.memberships?.some(m => m.lesson === Number(lesson)))).toBe(true);
    });
    expect(filterCollection(TOBIRA_KANJI, TOBIRA_COLLECTION_ID, [0, 1, 2])).toEqual([]);
  });

  it('keeps later homophones distinct while sharing repeated textbook targets', () => {
    expect(TOBIRA_WORDS.filter(card => card.char === 'はな').map(card => card.meanings?.[0])).toEqual(['A flower', 'A nose']);
    expect(TOBIRA_WORDS.filter(card => card.char === 'かく')).toHaveLength(2);
    const pool = filterCollection(TOBIRA_KANJI, TOBIRA_COLLECTION_ID, [3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(pool.map(card => card.id)).size).toBe(pool.length);
    expect(pool.filter(card => card.char === '四')).toHaveLength(1);
    expect(pool.find(card => card.char === '四')?.acceptedAnswers).toContain('よん');
  });

  it('preserves old ids when the same word is in the personal starter collection', () => {
    expect(TOBIRA_WORDS.find(card => card.char === 'ありがとう')?.id).toBe('w_arigatou');
    expect(TOBIRA_WORDS.find(card => card.char === 'こんにちは')?.id).toBe('w_konnichiwa');
  });
});
