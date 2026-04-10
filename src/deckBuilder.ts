import type { CardItem } from './types';

export interface RankedQueueEntry<TCard = CardItem, TDirectionStats = unknown> {
  card: TCard;
  isDue: boolean;
  isNew: boolean;
  directionStats: TDirectionStats;
}

export const shuffleCards = <TCard>(cards: TCard[]): TCard[] => {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
};

export const pickRandomCard = <TCard>(cards: TCard[]): TCard | null => {
  if (cards.length === 0) return null;
  return cards[Math.floor(Math.random() * cards.length)];
};

export const pickRandomCards = <TCard>(cards: TCard[], count: number): TCard[] => (
  shuffleCards(cards).slice(0, Math.max(0, count))
);

export const pickExperimentalNewCards = (cards: CardItem[], count: number): CardItem[] => {
  const frequencyCards = cards.filter(card => typeof card.frequency === 'number' && Number.isFinite(card.frequency));
  const nonFrequencyCards = cards.filter(card => typeof card.frequency !== 'number' || !Number.isFinite(card.frequency));
  const selected: CardItem[] = [];

  const removeCardById = (pool: CardItem[], id: string): CardItem[] => pool.filter(card => card.id !== id);

  let remainingFrequencyCards = [...frequencyCards];
  let remainingNonFrequencyCards = [...nonFrequencyCards];

  while (selected.length < count && (remainingFrequencyCards.length > 0 || remainingNonFrequencyCards.length > 0)) {
    const totalRemaining = remainingFrequencyCards.length + remainingNonFrequencyCards.length;
    const shouldPickFrequencyCard = remainingFrequencyCards.length > 0
      && (
        remainingNonFrequencyCards.length === 0
        || Math.random() < remainingFrequencyCards.length / totalRemaining
      );

    if (shouldPickFrequencyCard) {
      const highestFrequency = Math.max(...remainingFrequencyCards.map(card => card.frequency ?? Number.NEGATIVE_INFINITY));
      const highestFrequencyGroup = remainingFrequencyCards.filter(card => card.frequency === highestFrequency);
      const selectedCard = pickRandomCard(highestFrequencyGroup);

      if (!selectedCard) break;

      selected.push(selectedCard);
      remainingFrequencyCards = removeCardById(remainingFrequencyCards, selectedCard.id);
      continue;
    }

    const selectedCard = pickRandomCard(remainingNonFrequencyCards);
    if (!selectedCard) break;

    selected.push(selectedCard);
    remainingNonFrequencyCards = removeCardById(remainingNonFrequencyCards, selectedCard.id);
  }

  return selected;
};

export const buildExperimentalQueueFromBuckets = (
  buckets: Record<'new' | 'weak' | 'improving' | 'strong', CardItem[]>,
  sessionSize = 15,
): CardItem[] => {
  const baseStrongTarget = Math.min(3, buckets.strong.length);
  const nonStrongTarget = sessionSize - baseStrongTarget;
  const learningPoolSize = buckets.weak.length + buckets.improving.length;
  const learningTarget = Math.min(nonStrongTarget, learningPoolSize);
  const remainingAfterLearning = nonStrongTarget - learningTarget;
  const newTarget = Math.min(2, remainingAfterLearning, buckets.new.length);
  const remainingAfterNew = remainingAfterLearning - newTarget;
  const extraStrongPoolSize = Math.max(0, buckets.strong.length - baseStrongTarget);
  const extraStrongTarget = Math.min(remainingAfterNew, extraStrongPoolSize);
  const remainingAfterExtraStrong = remainingAfterNew - extraStrongTarget;
  const extraNewTarget = Math.min(remainingAfterExtraStrong, Math.max(0, buckets.new.length - newTarget));
  const strongTarget = baseStrongTarget + extraStrongTarget;
  const weakTarget = Math.min(buckets.weak.length, learningTarget);
  const improvingTarget = Math.min(buckets.improving.length, learningTarget - weakTarget);

  const selected = [
    ...pickRandomCards(buckets.strong, strongTarget),
    ...pickRandomCards(buckets.weak, weakTarget),
    ...pickRandomCards(buckets.improving, improvingTarget),
    ...pickExperimentalNewCards(buckets.new, newTarget + extraNewTarget),
  ];

  return shuffleCards(selected);
};

export const buildAdaptiveQueueFromRankedEntries = <TCard>(
  rankedCards: RankedQueueEntry<TCard, any>[],
  getBucket: (entry: RankedQueueEntry<TCard, any>) => 'new' | 'weak' | 'improving' | 'strong',
  sessionSize = 15,
): TCard[] => {
  const reviewedEntries = rankedCards.filter(entry => !entry.isNew);
  const dueReviewedEntries = reviewedEntries.filter(entry => entry.isDue);
  const dueReviewedCount = dueReviewedEntries.length;
  const weakDueEntries = dueReviewedEntries.filter(entry => getBucket(entry) === 'weak');
  const dueNonStrongEntries = dueReviewedEntries.filter(entry => getBucket(entry) !== 'strong');
  const introducedCardCount = reviewedEntries.length;

  let targetNewCards = introducedCardCount < sessionSize ? 3 : 2;

  if (dueReviewedCount === 0) {
    targetNewCards = Math.min(2, introducedCardCount < sessionSize ? 3 : 2);
  } else if (weakDueEntries.length >= 6 || dueNonStrongEntries.length >= 8) {
    targetNewCards = 0;
  } else if (weakDueEntries.length >= 3 || dueNonStrongEntries.length >= 4) {
    targetNewCards = 1;
  } else if (weakDueEntries.length <= 1 && dueNonStrongEntries.length <= 1 && introducedCardCount < sessionSize) {
    targetNewCards = 3;
  } else {
    targetNewCards = 2;
  }

  const maxNewCards = introducedCardCount < sessionSize ? 3 : 2;
  const dueLearningEntries = dueReviewedEntries.filter(entry => getBucket(entry) !== 'strong');
  const dueStrongEntries = dueReviewedEntries.filter(entry => getBucket(entry) === 'strong');
  const futureLearningEntries = rankedCards.filter(entry => !entry.isDue && !entry.isNew && getBucket(entry) !== 'strong');
  const futureStrongEntries = rankedCards.filter(entry => !entry.isDue && !entry.isNew && getBucket(entry) === 'strong');
  const newEntries = rankedCards.filter(entry => entry.isNew);
  const prioritizedEntries = [
    ...dueLearningEntries,
    ...dueStrongEntries,
    ...newEntries,
    ...futureLearningEntries,
    ...futureStrongEntries,
  ];
  const selected: TCard[] = [];
  const selectedIds = new Set<TCard>();
  let newCardsSelected = 0;

  for (const entry of prioritizedEntries) {
    if (selected.length >= sessionSize) break;
    if (selectedIds.has(entry.card)) continue;
    if (entry.isNew && newCardsSelected >= targetNewCards) continue;

    selected.push(entry.card);
    selectedIds.add(entry.card);

    if (entry.isNew) {
      newCardsSelected += 1;
    }
  }

  if (selected.length < sessionSize) {
    for (const entry of prioritizedEntries) {
      if (selected.length >= sessionSize) break;
      if (selectedIds.has(entry.card)) continue;
      if (entry.isNew && newCardsSelected >= maxNewCards) continue;

      selected.push(entry.card);
      selectedIds.add(entry.card);

      if (entry.isNew) {
        newCardsSelected += 1;
      }
    }
  }

  return selected;
};
