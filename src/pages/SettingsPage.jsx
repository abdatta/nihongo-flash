export default function SettingsPage({
  SettingsViewComponent,
  settings,
  setSettings,
  customItems,
  setCustomItems,
  hapticsSupported,
}) {
  return (
    <SettingsViewComponent
      settings={settings}
      setSettings={setSettings}
      customItems={customItems}
      setCustomItems={setCustomItems}
      hapticsSupported={hapticsSupported}
    />
  );
}
