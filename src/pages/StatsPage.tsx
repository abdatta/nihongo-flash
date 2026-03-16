import type { CardItem, StatsMap, StatsViewComponent } from '../types';

interface StatsPageProps {
  StatsViewComponent: StatsViewComponent;
  stats: StatsMap;
  allItems: CardItem[];
}

export default function StatsPage({ StatsViewComponent, stats, allItems }: StatsPageProps) {
  return <StatsViewComponent stats={stats} allItems={allItems} />;
}
