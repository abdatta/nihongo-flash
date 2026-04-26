import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSessionQueueFromBuckets,
  pickExperimentalNewCards,
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

describe('buildSessionQueueFromBuckets', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses frequency-aware picking only for new cards and keeps the session size bounded', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const queue = buildSessionQueueFromBuckets({
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
