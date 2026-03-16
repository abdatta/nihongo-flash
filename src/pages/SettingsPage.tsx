import type { SettingsViewComponent, SettingsViewProps } from '../types';

interface SettingsPageProps extends SettingsViewProps {
  SettingsViewComponent: SettingsViewComponent;
}

export default function SettingsPage({
  SettingsViewComponent,
  settings,
  setSettings,
  customItems,
  setCustomItems,
  wordItems,
  setWordItems,
  hapticsSupported,
}: SettingsPageProps) {
  return (
    <SettingsViewComponent
      settings={settings}
      setSettings={setSettings}
      customItems={customItems}
      setCustomItems={setCustomItems}
      wordItems={wordItems}
      setWordItems={setWordItems}
      hapticsSupported={hapticsSupported}
    />
  );
}
