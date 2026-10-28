import type { Dispatch, SetStateAction } from 'react';
import { GROUP_LABELS, TOBIRA_SETS, getWordGroups, filterCollection, TOBIRA_COLLECTION_ID } from '../studyCatalog';
import { TOBIRA_KANJI, TOBIRA_WORDS } from '../studyData';
import type { KanaOptions, SettingsState, StudyMode } from '../types';

const choiceClass = (active: boolean) => `min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-emerald-400 ${active ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`;

export function ContentToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl bg-zinc-900 px-4 py-3">
      <span className="font-medium text-zinc-200">{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className={`h-6 w-11 shrink-0 rounded-full p-1 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-300 ${checked ? 'bg-emerald-500' : 'bg-zinc-700'}`}><span className={`block h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} /></span>
    </label>
  );
}

export default function StudyScopeControls({ settings, setSettings }: { settings: SettingsState; setSettings: Dispatch<SetStateAction<SettingsState>> }) {
  const isWords = settings.studyMode === 'words';
  const groups = getWordGroups(settings.wordLessons);
  const renderKana = (script: 'hiragana' | 'katakana') => {
    const optionsKey = script === 'hiragana' ? 'hiraganaOptions' : 'katakanaOptions';
    const scriptLabel = script === 'hiragana' ? 'Hiragana' : 'Katakana';
    const samples = script === 'hiragana' ? ['あ', 'が', 'ぱ', 'きゃ・ぎゃ・ぴゃ'] : ['ア', 'ガ', 'パ', 'キャ・ギャ・ピャ'];
    return (
      <div role="group" aria-label={scriptLabel} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
        <ContentToggle label={scriptLabel} checked={settings[script]} onChange={value => setSettings(s => ({ ...s, [script]: value }))} />
        {settings[script] && <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 p-3">
          {(['basic', 'dakuten', 'handakuten', 'yoon'] as (keyof KanaOptions)[]).map((key, index) => (
            <button type="button" key={key} aria-label={`${script === 'hiragana' ? 'Hiragana' : 'Katakana'} ${key}`} aria-pressed={settings[optionsKey][key]} onClick={() => setSettings(s => ({ ...s, [optionsKey]: { ...s[optionsKey], [key]: !s[optionsKey][key] } }))} className={choiceClass(settings[optionsKey][key])}>
              <span className="block capitalize">{key}</span>
              <span lang="ja" className={`mt-1 block text-xs font-normal ${settings[optionsKey][key] ? 'text-emerald-300/70' : 'text-zinc-500'}`}>{samples[index]}</span>
            </button>
          ))}
        </div>}
      </div>
    );
  };
  const selectSet = (setId: number) => setSettings(s => {
    const key = isWords ? 'wordLessons' : 'characterLessons';
    const mixed = isWords ? s.mixWordLessons : s.mixCharacterLessons;
    const selected = s[key];
    return { ...s, [key]: mixed ? (selected.includes(setId) ? selected.filter(n => n !== setId) : [...selected, setId].sort((a, b) => a - b)) : [setId], ...(isWords ? { wordGroups: [] } : {}) };
  });
  const selectedSets = isWords ? settings.wordLessons : settings.characterLessons;
  const mixKey = isWords ? 'mixWordLessons' : 'mixCharacterLessons';
  const selectionKey = isWords ? 'wordLessons' : 'characterLessons';
  const renderSets = () => (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Sets</h3>
        <button type="button" role="switch" aria-checked={settings[mixKey]} aria-label="Mix sets" onClick={() => setSettings(s => ({ ...s, [mixKey]: !s[mixKey], [selectionKey]: !s[mixKey] ? s[selectionKey] : s[selectionKey].slice(0, 1), ...(isWords ? { wordGroups: [] } : {}) }))} className={`relative inline-flex items-center gap-2 py-1 text-xs font-semibold transition-colors before:absolute before:-inset-y-3 before:inset-x-0 focus-visible:outline focus-visible:outline-emerald-400 ${settings[mixKey] ? 'text-emerald-300 hover:text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}>
          <span aria-hidden="true" className={`h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors ${settings[mixKey] ? 'bg-emerald-500' : 'bg-zinc-700'}`}><span className={`block h-3 w-3 rounded-full bg-white transition-transform ${settings[mixKey] ? 'translate-x-3' : ''}`} /></span>
          <span>Mix sets</span>
        </button>
      </div>
      <div role="group" aria-label="Tobira I sets" className="grid grid-cols-4 gap-2 min-[480px]:grid-cols-6">
        {TOBIRA_SETS.filter(set => isWords || set.id >= 3).map(set => {
          const count = filterCollection(isWords ? TOBIRA_WORDS : TOBIRA_KANJI, TOBIRA_COLLECTION_ID, [set.id]).length;
          return <button type="button" key={set.id} aria-label={`Lesson ${set.id}: ${set.description}, ${count} items`} title={`Lesson ${set.id}: ${set.description} · ${count} items`} aria-pressed={selectedSets.includes(set.id)} className={choiceClass(selectedSets.includes(set.id))} onClick={() => selectSet(set.id)}>{set.label}</button>;
        })}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-zinc-500">{selectedSets.map(n => { const set = TOBIRA_SETS.find(item => item.id === n); return set ? `${set.label} · ${set.description} (${filterCollection(isWords ? TOBIRA_WORDS : TOBIRA_KANJI, TOBIRA_COLLECTION_ID, [n]).length})` : ''; }).filter(Boolean).join(' / ') || 'Choose a set to study.'}</p>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2" aria-label="Study mode">
        {(['characters', 'words'] as StudyMode[]).map(mode => <button type="button" key={mode} aria-pressed={settings.studyMode === mode} onClick={() => setSettings(s => ({ ...s, studyMode: mode }))} className={choiceClass(settings.studyMode === mode)}>{mode === 'characters' ? 'Characters' : 'Words'}</button>)}
      </div>
      {!isWords ? <>
        {renderKana('hiragana')}
        {renderKana('katakana')}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Kanji sets</h3>
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900">
            <ContentToggle label="Tobira I Kanji" checked={settings.tobiraKanji} onChange={value => setSettings(s => ({ ...s, tobiraKanji: value }))} />
            {settings.tobiraKanji && <div className="border-t border-zinc-800 p-3">{renderSets()}<p className="mt-2 text-xs text-zinc-500">Kanji starts in L3. Counts show reading & writing items.</p></div>}
          </div>
          <ContentToggle label="JLPT N5 Kanji" checked={settings.jlptN5Kanji} onChange={value => setSettings(s => ({ ...s, jlptN5Kanji: value }))} />
          <ContentToggle label="Custom Kanji" checked={settings.kanji} onChange={value => setSettings(s => ({ ...s, kanji: value }))} />
        </div>
        {(settings.jlptN5Kanji || settings.kanji) && <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500">Kanji readings</h3>
          <ContentToggle label="Onyomi" checked={settings.showOnyomi} onChange={value => setSettings(s => ({ ...s, showOnyomi: value }))} />
          <ContentToggle label="Kunyomi" checked={settings.showKunyomi} onChange={value => setSettings(s => ({ ...s, showKunyomi: value }))} />
        </div>}
      </> : <>
        <div className="grid grid-cols-2 gap-2" aria-label="Vocabulary collection">
          <button type="button" aria-pressed={settings.wordSource === 'tobira'} className={choiceClass(settings.wordSource === 'tobira')} onClick={() => setSettings(s => ({ ...s, wordSource: 'tobira' }))}>Tobira I</button>
          <button type="button" aria-pressed={settings.wordSource === 'personal'} className={choiceClass(settings.wordSource === 'personal')} onClick={() => setSettings(s => ({ ...s, wordSource: 'personal' }))}>Personal deck</button>
        </div>
        {settings.wordSource === 'tobira' && <>
          {renderSets()}
          {groups.length > 0 && <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-zinc-500">Categories</h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={settings.wordGroups.length === 0} className={choiceClass(settings.wordGroups.length === 0)} onClick={() => setSettings(s => ({ ...s, wordGroups: [] }))}>All items</button>
              {groups.map(group => <button type="button" key={group} aria-pressed={settings.wordGroups.includes(group)} className={choiceClass(settings.wordGroups.includes(group))} onClick={() => setSettings(s => ({ ...s, wordGroups: s.wordGroups.includes(group) ? s.wordGroups.filter(g => g !== group) : [...s.wordGroups, group] }))}>{GROUP_LABELS[group] ?? group}</button>)}
            </div>
          </div>}
        </>}
      </>}
    </div>
  );
}
