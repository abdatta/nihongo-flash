import type { PracticeSessionComponent, PracticeSessionComponentProps } from '../types';

interface RecallPageProps {
  PracticeSessionComponent: PracticeSessionComponent;
  sessionProps: PracticeSessionComponentProps;
}

export default function RecallPage({ PracticeSessionComponent, sessionProps }: RecallPageProps) {
  return <PracticeSessionComponent {...sessionProps} direction="r2k" />;
}
