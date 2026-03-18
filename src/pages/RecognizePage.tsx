import type { PracticeSessionComponent, PracticeSessionComponentProps } from '../types';

interface RecognizePageProps {
  PracticeSessionComponent: PracticeSessionComponent;
  sessionProps: PracticeSessionComponentProps;
}

export default function RecognizePage({ PracticeSessionComponent, sessionProps }: RecognizePageProps) {
  return <PracticeSessionComponent {...sessionProps} direction="k2r" />;
}
