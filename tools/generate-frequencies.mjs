import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import https from 'node:https';
import { toKatakana } from 'wanakana';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const studyDataPath = join(repoRoot, 'src', 'studyData.json');
const studyFrequenciesPath = join(repoRoot, 'src', 'studyFrequencies.json');
const cacheDir = join(repoRoot, '.frequency-cache', 'bccwj');

const corpusSources = {
  suwZip: {
    url: 'https://repository.ninjal.ac.jp/record/3234/files/BCCWJ_frequencylist_suw_ver1_0.zip',
    archivePath: join(cacheDir, 'bccwj_suw.zip'),
    extractDir: join(cacheDir, 'suw'),
    tsvPath: join(cacheDir, 'suw', 'BCCWJ_frequencylist_suw_ver1_0.tsv'),
  },
  luw2Zip: {
    url: 'https://repository.ninjal.ac.jp/record/3230/files/BCCWJ_frequencylist_luw2_ver1_0.zip',
    archivePath: join(cacheDir, 'bccwj_luw2.zip'),
    extractDir: join(cacheDir, 'luw2'),
    tsvPath: join(cacheDir, 'luw2', 'BCCWJ_frequencylist_luw2_ver1_0.tsv'),
  },
};

const studyData = JSON.parse(readFileSync(studyDataPath, 'utf8'));
const allCards = [
  ...studyData.baseHiragana,
  ...studyData.hiraganaDakuten,
  ...studyData.hiraganaHandakuten,
  ...studyData.hiraganaYoon,
  ...studyData.baseKatakana,
  ...studyData.katakanaDakuten,
  ...studyData.katakanaHandakuten,
  ...studyData.katakanaYoon,
  ...studyData.jlptN5Kanji,
  ...studyData.defaultWords,
];

const cardStats = new Map(allCards.map(card => [card.id, {
  card,
  luwExact: 0,
  luwLemmaExact: 0,
  luwSubstring: 0,
  luwLemmaSubstring: 0,
  suwExact: 0,
  suwLemmaExact: 0,
  suwSubstring: 0,
  suwLemmaSubstring: 0,
}]));

const countOccurrences = (text, target) => {
  if (!text || !target) return 0;

  let count = 0;
  let startIndex = 0;

  while (startIndex <= text.length - target.length) {
    const nextIndex = text.indexOf(target, startIndex);
    if (nextIndex === -1) break;
    count += 1;
    startIndex = nextIndex + target.length;
  }

  return count;
};

const downloadFile = (url, destinationPath) => new Promise((resolvePromise, rejectPromise) => {
  const file = createWriteStream(destinationPath);

  https.get(url, response => {
    if (response.statusCode !== 200) {
      file.close();
      rejectPromise(new Error(`Download failed for ${url} with status ${response.statusCode}`));
      return;
    }

    response.pipe(file);

    file.on('finish', () => {
      file.close();
      resolvePromise();
    });
  }).on('error', error => {
    file.close();
    rejectPromise(error);
  });
});

const expandArchive = (archivePath, extractDir) => new Promise((resolvePromise, rejectPromise) => {
  const child = spawn('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
  ], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  child.on('exit', code => {
    if (code === 0) {
      resolvePromise();
      return;
    }

    rejectPromise(new Error(`Expand-Archive failed for ${archivePath} with exit code ${code}`));
  });
});

const processTsv = async (tsvPath, kind) => {
  const reader = createInterface({
    input: createReadStream(tsvPath),
    crlfDelay: Infinity,
  });

  let indexes = null;
  let isFirstLine = true;

  for await (const line of reader) {
    if (!line) continue;

    const columns = line.split('\t');

    if (isFirstLine) {
      indexes = {
        lForm: columns.indexOf('lForm'),
        lemma: columns.indexOf('lemma'),
        frequency: columns.indexOf('frequency'),
      };
      isFirstLine = false;
      continue;
    }

    const frequency = Number(columns[indexes.frequency]);
    if (!Number.isFinite(frequency) || frequency <= 0) continue;

    const lForm = columns[indexes.lForm];
    const lemma = columns[indexes.lemma];

    for (const stats of cardStats.values()) {
      const target = stats.card.char;
      const katakanaTarget = toKatakana(target);
      if (lForm === target) stats[`${kind}Exact`] += frequency;
      if (lemma === target) stats[`${kind}LemmaExact`] += frequency;
      if (katakanaTarget !== target && lForm === katakanaTarget) stats[`${kind}Exact`] += frequency;

      const substringOccurrences = countOccurrences(lForm, target);
      if (substringOccurrences > 0) {
        stats[`${kind}Substring`] += frequency * substringOccurrences;
      }

      if (katakanaTarget !== target) {
        const katakanaSubstringOccurrences = countOccurrences(lForm, katakanaTarget);
        if (katakanaSubstringOccurrences > 0) {
          stats[`${kind}Substring`] += frequency * katakanaSubstringOccurrences;
        }
      }

      const lemmaSubstringOccurrences = countOccurrences(lemma, target);
      if (lemmaSubstringOccurrences > 0) {
        stats[`${kind}LemmaSubstring`] += frequency * lemmaSubstringOccurrences;
      }
    }
  }
};

const ensureCache = () => {
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
};

const main = async () => {
  ensureCache();

  console.log('Downloading official BCCWJ archives...');
  await downloadFile(corpusSources.suwZip.url, corpusSources.suwZip.archivePath);
  await downloadFile(corpusSources.luw2Zip.url, corpusSources.luw2Zip.archivePath);

  console.log('Extracting archives...');
  await expandArchive(corpusSources.suwZip.archivePath, corpusSources.suwZip.extractDir);
  await expandArchive(corpusSources.luw2Zip.archivePath, corpusSources.luw2Zip.extractDir);

  console.log('Processing LUW2 frequencies...');
  await processTsv(corpusSources.luw2Zip.tsvPath, 'luw');
  console.log('Processing SUW frequencies...');
  await processTsv(corpusSources.suwZip.tsvPath, 'suw');

  const nextFrequencyMap = {};
  const zeroFrequencyIds = [];
  const wordFallbackIds = [];

  for (const [id, stats] of cardStats.entries()) {
    const isWord = stats.card.type === 'word';
    const exactFrequency = stats.luwExact + stats.luwLemmaExact;
    const fallbackExactFrequency = stats.suwExact + stats.suwLemmaExact;
    let frequency;

    if (isWord) {
      frequency = exactFrequency
        || fallbackExactFrequency
        || stats.luwLemmaSubstring
        || stats.luwSubstring
        || stats.suwLemmaSubstring
        || stats.suwSubstring
        || 0;
      if (frequency > 0 && exactFrequency === 0 && fallbackExactFrequency === 0) {
        wordFallbackIds.push(id);
      }
    } else {
      frequency = stats.luwLemmaSubstring
        || stats.luwSubstring
        || stats.suwLemmaSubstring
        || stats.suwSubstring
        || exactFrequency
        || fallbackExactFrequency
        || 0;
    }

    nextFrequencyMap[id] = frequency;
    if (frequency === 0) {
      zeroFrequencyIds.push(id);
    }
  }

  writeFileSync(studyFrequenciesPath, `${JSON.stringify(nextFrequencyMap, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${studyFrequenciesPath}`);
  if (wordFallbackIds.length > 0) {
    console.log(`Words using substring fallback: ${wordFallbackIds.join(', ')}`);
  }
  if (zeroFrequencyIds.length > 0) {
    console.warn(`Items with zero corpus frequency: ${zeroFrequencyIds.join(', ')}`);
  }
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
