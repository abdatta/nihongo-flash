import type { PracticeSessionComponent, PracticeSessionComponentProps } from '../types';

interface WritePageProps {
  PracticeSessionComponent: PracticeSessionComponent;
  sessionProps: PracticeSessionComponentProps;
}

export default function WritePage({ PracticeSessionComponent, sessionProps }: WritePageProps) {
  return <PracticeSessionComponent {...sessionProps} direction="r2k" />;
}
