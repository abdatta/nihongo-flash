import type { CardItem, StatsMap, StatsViewComponent, StudyMode } from '../types';

interface StatsPageProps {
  StatsViewComponent: StatsViewComponent;
  stats: StatsMap;
  allItems: CardItem[];
  studyMode: StudyMode;
}

export default function StatsPage({ StatsViewComponent, stats, allItems, studyMode }: StatsPageProps) {
  return <StatsViewComponent stats={stats} allItems={allItems} studyMode={studyMode} />;
}
