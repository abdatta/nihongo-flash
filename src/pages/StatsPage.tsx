import type { CardItem, StatsMap, StatsViewComponent, StudyMode } from '../types';

interface StatsPageProps {
  StatsViewComponent: StatsViewComponent;
  stats: StatsMap;
  allItems: CardItem[];
  activePool: CardItem[];
  studyMode: StudyMode;
}

export default function StatsPage({ StatsViewComponent, stats, allItems, activePool, studyMode }: StatsPageProps) {
  return <StatsViewComponent stats={stats} allItems={allItems} activePool={activePool} studyMode={studyMode} />;
}
