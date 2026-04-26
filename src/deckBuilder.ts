import type { CardItem } from './types';

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

export const buildSessionQueueFromBuckets = (
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
