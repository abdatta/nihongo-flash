import type { CardItem, Direction, StatsMap, StatsViewComponent, StudyMode } from '../types';

interface StatsPageProps {
  StatsViewComponent: StatsViewComponent;
  stats: StatsMap;
  allItems: CardItem[];
  activePool: CardItem[];
  studyMode: StudyMode;
  onResetStatCategory: (cardIds: string[], direction: Direction) => void;
  onResetStatItem: (cardIds: string[], direction: Direction) => void;
}

export default function StatsPage({
  StatsViewComponent,
  stats,
  allItems,
  activePool,
  studyMode,
  onResetStatCategory,
  onResetStatItem,
}: StatsPageProps) {
  return (
    <StatsViewComponent
      stats={stats}
      allItems={allItems}
      activePool={activePool}
      studyMode={studyMode}
      onResetStatCategory={onResetStatCategory}
      onResetStatItem={onResetStatItem}
    />
  );
}
