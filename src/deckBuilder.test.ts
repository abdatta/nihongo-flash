import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAdaptiveQueueFromRankedEntries,
  buildExperimentalQueueFromBuckets,
  pickExperimentalNewCards,
  type RankedQueueEntry,
} from './deckBuilder';
import type { CardItem } from './types';

const makeCard = (id: string, frequency?: number): CardItem => ({
  id,
  char: id,
  romaji: id,
  type: 'hiragana',
  ...(typeof frequency === 'number' ? { frequency } : {}),
});

describe('pickExperimentalNewCards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('picks the highest-frequency card first when frequency-backed cards win the weighted choice', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.6);

    const cards = [
      makeCard('freq-low', 10),
      makeCard('freq-high', 100),
      makeCard('custom'),
    ];

    const selected = pickExperimentalNewCards(cards, 1);

    expect(selected.map(card => card.id)).toEqual(['freq-high']);
  });

  it('randomizes ties among cards with the same highest frequency', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.9);

    const cards = [
      makeCard('freq-a', 100),
      makeCard('freq-b', 100),
      makeCard('freq-c', 50),
    ];

    const selected = pickExperimentalNewCards(cards, 1);

    expect(selected.map(card => card.id)).toEqual(['freq-b']);
  });

  it('uses weighted random selection between frequency-backed and non-frequency pools', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.4);

    const cards = [
      ...Array.from({ length: 85 }, (_, index) => makeCard(`freq-${index}`, 100 - index)),
      ...Array.from({ length: 15 }, (_, index) => makeCard(`custom-${index}`)),
    ];

    const selected = pickExperimentalNewCards(cards, 1);

    expect(selected[0]?.id).toBe('custom-6');
  });

  it('falls back to random selection when only non-frequency cards are available', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.75);

    const cards = [makeCard('custom-a'), makeCard('custom-b'), makeCard('custom-c')];

    const selected = pickExperimentalNewCards(cards, 1);

    expect(selected.map(card => card.id)).toEqual(['custom-c']);
  });

  it('never selects the same new card twice', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.1);

    const cards = [
      makeCard('freq-a', 100),
      makeCard('freq-b', 90),
      makeCard('custom-a'),
    ];

    const selected = pickExperimentalNewCards(cards, 3);

    expect(new Set(selected.map(card => card.id)).size).toBe(selected.length);
    expect(selected).toHaveLength(3);
  });
});

describe('buildExperimentalQueueFromBuckets', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses frequency-aware picking only for new cards and keeps the session size bounded', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const queue = buildExperimentalQueueFromBuckets({
      strong: [makeCard('strong-1'), makeCard('strong-2')],
      weak: [makeCard('weak-1')],
      improving: [makeCard('improving-1')],
      new: [makeCard('new-low', 1), makeCard('new-high', 10), makeCard('new-custom')],
    }, 5);

    expect(queue).toHaveLength(5);
    expect(queue.some(card => card.id === 'new-high')).toBe(true);
    expect(queue.some(card => card.id === 'new-low')).toBe(false);
  });
});

describe('buildAdaptiveQueueFromRankedEntries', () => {
  it('does not reorder new cards by frequency in the non-experimental adaptive path', () => {
    const rankedEntries: RankedQueueEntry<CardItem>[] = [
      { card: makeCard('due-weak'), isDue: true, isNew: false, directionStats: { bucket: 'weak' } },
      { card: makeCard('new-low', 1), isDue: true, isNew: true, directionStats: { bucket: 'new' } },
      { card: makeCard('new-high', 100), isDue: true, isNew: true, directionStats: { bucket: 'new' } },
      { card: makeCard('future-strong'), isDue: false, isNew: false, directionStats: { bucket: 'strong' } },
    ];

    const queue = buildAdaptiveQueueFromRankedEntries(
      rankedEntries,
      entry => (entry.directionStats as unknown as { bucket: 'new' | 'weak' | 'improving' | 'strong' }).bucket,
      4,
    );

    expect(queue.map(card => card.id)).toEqual(['due-weak', 'new-low', 'new-high', 'future-strong']);
  });

  it('caps new cards when the learner already has enough due weak items', () => {
    const dueWeakEntries: RankedQueueEntry<CardItem>[] = Array.from({ length: 6 }, (_, index) => ({
      card: makeCard(`weak-${index}`),
      isDue: true,
      isNew: false,
      directionStats: { bucket: 'weak' as const },
    }));
    const fillerEntries: RankedQueueEntry<CardItem>[] = Array.from({ length: 2 }, (_, index) => ({
      card: makeCard(`future-strong-${index}`),
      isDue: false,
      isNew: false,
      directionStats: { bucket: 'strong' as const },
    }));
    const newEntries: RankedQueueEntry<CardItem>[] = [
      { card: makeCard('new-a', 100), isDue: true, isNew: true, directionStats: { bucket: 'new' as const } },
      { card: makeCard('new-b', 90), isDue: true, isNew: true, directionStats: { bucket: 'new' as const } },
    ];

    const queue = buildAdaptiveQueueFromRankedEntries(
      [...dueWeakEntries, ...newEntries, ...fillerEntries],
      entry => (entry.directionStats as unknown as { bucket: 'new' | 'weak' | 'improving' | 'strong' }).bucket,
      8,
    );

    expect(queue.map(card => card.id)).not.toContain('new-a');
    expect(queue.map(card => card.id)).not.toContain('new-b');
  });
});
