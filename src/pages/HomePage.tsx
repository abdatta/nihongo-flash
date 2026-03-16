import type { PracticeSessionComponent, PracticeSessionComponentProps } from '../types';

interface HomePageProps {
  PracticeSessionComponent: PracticeSessionComponent;
  sessionProps: PracticeSessionComponentProps;
}

export default function HomePage({ PracticeSessionComponent, sessionProps }: HomePageProps) {
  return <PracticeSessionComponent {...sessionProps} direction="k2r" />;
}
