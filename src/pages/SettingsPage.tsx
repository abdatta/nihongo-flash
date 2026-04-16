import type { SettingsViewComponent, SettingsViewProps } from '../types';

interface SettingsPageProps extends SettingsViewProps {
  SettingsViewComponent: SettingsViewComponent;
}

export default function SettingsPage({
  SettingsViewComponent,
  settings,
  setSettings,
  stats,
  setStats,
  customItems,
  setCustomItems,
  wordItems,
  setWordItems,
  hapticsSupported,
  showCharacterOptionsSection,
  showKanjiReadingSettings,
  showKanaVariationSettings,
}: SettingsPageProps) {
  return (
    <SettingsViewComponent
      settings={settings}
      setSettings={setSettings}
      stats={stats}
      setStats={setStats}
      customItems={customItems}
      setCustomItems={setCustomItems}
      wordItems={wordItems}
      setWordItems={setWordItems}
      hapticsSupported={hapticsSupported}
      showCharacterOptionsSection={showCharacterOptionsSection}
      showKanjiReadingSettings={showKanjiReadingSettings}
      showKanaVariationSettings={showKanaVariationSettings}
    />
  );
}
