# Study content and Tobira I

Characters and Words remain the two study modes. Recognize and Recall remain the two directions. The default flow is labeled “Regular session” and uses up to 15 cards. Full deck runs are started from either page after a confirmation, cover every selected ID once, and pass only when every response is correct. The confirmation's “Not now” action simply dismisses it. A miss does not stop the run; the summary lists missed items and offers “Review missed items.” Responses update the existing per-item, per-direction progress. A full run is a self-check, including manual assessment of handwriting, not handwriting recognition.

Full deck runs start from the quiet square flame-icon button to the left of the practice content selector. There is no promotional button below the flashcard. Runs have a separate orange/amber challenge treatment. Progress uses a warm gradient with a brighter leading edge, clipped inside the bar. Progress transitions are disabled when reduced motion is requested. The confirmation offers an optional timed run, initially off, with defaults of 3 seconds per character or 5 seconds per word; the limit can be set to a whole number from 1 to 60. The clock starts for each new item and stops at Reveal or Check Answer. Expiry reveals the answer, locks the item as missed, and waits for Continue; it cannot be graded Got it. Timed word Recall focuses the input and supports Enter outside IME composition. Timer choices are temporary run configuration, not persisted preferences.

## Data

`src/studyData.json` is the source of truth for study items. The complete Tobira I collection spans L0–L10, with 909 unique vocabulary items and 285 unique kanji reading/writing tasks. All 236 original pilot card IDs, fields, and memberships are preserved. Cross-list repeats share a card when their senses match; homophones and different senses retain separate IDs.

The content was transcribed and visually checked against the supplied **Tobira I: Beginning Japanese**, Japanese edition. English glosses are paraphrased. Counts include separate example forms (such as months, dates, and family relationships); alternative readings for one prompt share a card.

| Set | Vocabulary | Kanji tasks | Vocabulary pages | Kanji pages |
| --- | ---: | ---: | --- | --- |
| L0 | 51 | 0 | 15–20 | — |
| L1 | 93 | 0 | 34–37 | — |
| L2 | 94 | 0 | 56–59 | — |
| L3 | 105 | 38 | 90–91 | 92–93 |
| L4 | 93 | 41 | 122–123 | 124–126 |
| L5 | 90 | 53 | 156–157 | 158–160 |
| L6 | 93 | 34 | 192–193 | 194–196 |
| L7 | 71 | 27 | 224–225 | 226–228 |
| L8 | 79 | 41 | 264–265 | 266–268 |
| L9 | 71 | 27 | 302–303 | 304–306 |
| L10 | 73 | 24 | 340–341 | 342–344 |

This covers the main vocabulary lists and the kanji sections' highlighted targets and new readings, with an example for each of the 139 introduced kanji (including five kanji-as-elements). Supplementary unhighlighted dictionary examples, grammar exercises, illustrations, pitch-accent notation, and audio are outside the flashcard collection. Templates use concrete, answerable examples rather than blank placeholders.

Kanji starts in L3. Enable **Tobira I Kanji** under Characters to choose L3–L10; selections and mixing are independent of Words. Targets are whole written forms (single kanji or words with okurigana/compounds), with their kana and meaning. These contextual reading tasks do not get a blanket onyomi/kunyomi label, since compounds and special readings do not fit that classification. Existing JLPT reading filters still apply to cards with reading metadata. Recall shows the meaning before drawing to disambiguate homophones; Reveal shows the complete written answer. Textbook romaji remains optional.

The reviewed L3–L10 vocabulary input and L3–L10 kanji input live in `tools/data/`. `node tools/expand-tobira.mjs` imports them without changing preexisting cards and is idempotent. New IDs use a stable digest of the written form and sense, not romaji alone. Once shipped, preserve existing IDs when changing glosses; edit the bundled card rather than generating a new persistence key. `TOBIRA_KANJI_TARGETS` records each lesson's introduced characters so automated checks catch missing coverage.

## Extending the collection

Each textbook item has `kana`, optional `acceptedAnswers`, a stable `order`, and one or more `memberships`:

```json
{ "collectionId": "tobira-1", "lesson": 2, "group": "verbs" }
```

The general selector headings are “Sets” and “Categories.” Set labels come from `StudySetDefinition` metadata: Tobira's labels are “L0” through “L10,” while another collection can supply names such as “JLPT N5 Part 1.” Categories are optional membership metadata and are shown only when present in the selected sets. The compact “Mix sets” switch sits beside the Sets heading. All set buttons stay visible: four columns on narrow screens and six on wider screens, with 44px minimum touch targets. Accessible labels/tooltips retain the full lesson number, description, and count; selected titles and counts appear below the grid.

Add sets to `TOBIRA_SETS` in `src/studyCatalog.ts` after their data is verified. `filterCollection` filters the item's memberships and deduplicates by ID. New curriculum material enters practice in book order; subsequent session ordering remains shuffled. Personal words and character settings are independent of the selected textbook vocabulary. The set/category filters do not remove kana from whole words. Existing persisted `wordLessons`/`characterLessons` keys and membership `lesson` IDs are retained for compatibility; changing display terminology does not migrate progress or saved selections.

Use the same ID for the same learning item in multiple collections. Use separate IDs for different senses or reading tasks. For later kanji lessons, attach memberships to the relevant reading task rather than assigning all readings to the character's first lesson. Kanji `readingType` and `readingRange` remain on the card itself.

Flashcard prompt sizing uses both text length and the card content width. Single characters keep the large display size; short compounds such as 日曜日 shrink to stay on one line at narrow mobile widths. Longer phrases wrap with reserved space above the actions, and cards grow naturally with the answer.

## Persistence and migration

Settings store independent `hiraganaOptions` and `katakanaOptions`, including a switch for Basic. Legacy shared kana options are copied to both scripts on load. Existing users retain the Personal words deck; new users default to Tobira Lesson 0 when they select Words. Character and word lesson selections and mixing preferences are saved independently. Switching lessons clears vocabulary subgroup filters.

Stats stay keyed by stable item ID and direction; labels remain computed. Collection membership and textbook order are bundled source data, not user progress. Full-run results and in-progress queues are temporary and restart as ordinary practice after a page change or refresh. Backup export continues to include current settings and progress; the existing import workflow merges progress only.

No routing, service-worker cache strategy, or asset base paths changed. The production build uses relative asset URLs and was checked under `/nihongo-flash/`.

Run `npm test` and `npm run build` after changes to selection, answers, or study data.
