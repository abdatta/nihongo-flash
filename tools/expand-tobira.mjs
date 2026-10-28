import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { toRomaji, toHiragana } from 'wanakana';

// Offline, audited transcription inputs. Existing cards/IDs always win on rerun.
const file = new URL('../src/studyData.json', import.meta.url);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const collectionId = 'tobira-1';
const stableId = (prefix, identity) => `${prefix}_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
const romanOverrides = { 'ティーシャツ': 'tiishatsu', 'エーティーエム': 'eetiiemu' };
const romanize = kana => romanOverrides[kana] ?? toRomaji(kana).toLowerCase();
const phonetic = value => value.replace(/ou/g, 'oo').replace(/ei/g, 'ee');
const addMembership = (card, lesson, group) => {
  const membership = { collectionId, lesson, ...(group ? { group } : {}) };
  if (!card.memberships.some(m => m.collectionId === collectionId && m.lesson === lesson && m.group === group)) card.memberships.push(membership);
};

// Same pronunciation can represent different learning tasks; only these reviewed
// cross-list repeats share a card when their English gloss differs.
const sharedWords = new Set(['すき', 'たいてい', 'ごめん', 'しつれいします']);
const words = data.tobiraWords;
let lesson;
let group;
let order = 1000;
for (const line of fs.readFileSync(new URL('./data/tobira-remaining-vocabulary.txt', import.meta.url), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  if (line.startsWith('@')) { const parts = line.slice(1).split('|'); lesson = Number(parts[0]); group = parts[1]; continue; }
  const [form, meaning, alternatives = ''] = line.split('|');
  if (!lesson || !group || !form || !meaning) throw new Error(`Incomplete vocabulary row: ${line}`);
  const kana = form === 'Ｔシャツ' ? 'ティーシャツ' : form;
  const id = stableId('t_w', `${form}|${meaning}`);
  let card = words.find(c => c.id === id || (c.char === form && (c.meanings.includes(meaning) || sharedWords.has(form))));
  if (!card) {
    const romaji = romanize(kana);
    const aliases = alternatives.split(';').filter(Boolean);
    for (const reading of [romaji, ...aliases.map(romanize)]) {
      const spoken = phonetic(reading);
      if (spoken !== romaji) aliases.push(spoken);
    }
    card = { id, char: form, romaji, type: 'word', kana, meanings: [meaning], order, memberships: [] };
    if (aliases.length) card.acceptedAnswers = [...new Set(aliases)];
    words.push(card);
  }
  addMembership(card, lesson, group);
  order++;
}

const kanji = data.tobiraKanji;
order = 1000;
for (const line of fs.readFileSync(new URL('./data/tobira-kanji.txt', import.meta.url), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  if (line.startsWith('@')) { lesson = Number(line.slice(1)); continue; }
  const [char, kana, meaning] = line.split('|');
  if (!lesson || !char || !kana || !meaning) throw new Error(`Incomplete kanji row: ${line}`);
  // Alternative readings with the same meaning belong to the same prompt.
  const id = stableId('t_k', `${char}|${meaning}`);
  let card = kanji.find(c => c.id === id);
  if (!card) {
    card = { id, char, kana, romaji: romanize(kana), type: 'kanji', meanings: [meaning], order, memberships: [] };
    kanji.push(card);
  } else if (toHiragana(card.kana) !== toHiragana(kana)) {
    card.acceptedAnswers = [...new Set([...(card.acceptedAnswers ?? []), kana])];
  }
  addMembership(card, lesson);
  order++;
}

// Preserve the existing, compact one-card-per-line study-data formatting.
const text = fs.readFileSync(file, 'utf8');
const start = text.indexOf('  "tobiraWords":');
if (start < 0 || !text.includes('  "tobiraKanji":', start)) throw new Error('Expected textbook sections at end of studyData.json');
const section = (key, cards) => `  "${key}": [\n${cards.map(c => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`;
fs.writeFileSync(file, text.slice(0, start) + section('tobiraWords', words) + ',\n' + section('tobiraKanji', kanji) + '\n}\n', 'utf8');
for (let n = 0; n <= 10; n++) console.log(`L${n}: ${words.filter(c => c.memberships.some(m => m.lesson === n)).length} vocabulary, ${kanji.filter(c => c.memberships.some(m => m.lesson === n)).length} kanji tasks`);
console.log(`${words.length} unique vocabulary items; ${kanji.length} unique kanji tasks`);
