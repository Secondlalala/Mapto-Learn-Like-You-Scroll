# Android APK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an ARM64 Android 10+ APK with an independent mobile UI, local SQLite data, direct DeepSeek cloud generation, and bundled offline Chinese TTS while leaving the desktop web client unchanged.

**Architecture:** A bare React Native app lives in `book-concept-app/android-app/`. TypeScript services own parsing, prompts, generation state, and cache keys; Android native integrations provide encrypted secrets, SQLite/file storage, and Sherpa-ONNX speech synthesis. The Android app never calls the desktop FastAPI service.

**Tech Stack:** React Native, TypeScript, React Navigation, SQLite, Android Keystore-backed storage, React Native WebView with KaTeX, Sherpa-ONNX, VITS Chinese model, Jest, React Native Testing Library, Gradle.

## Global Constraints

- Keep `book-concept-app/frontend/` and `book-concept-app/backend/` behavior and layout unchanged.
- Create Android product sources under `book-concept-app/android-app/`.
- Target Android 10 (API 29) or newer.
- Ship only `arm64-v8a`.
- Bundle `sherpa-onnx-vits-zh-ll` and its text-normalization resources in the APK.
- Store the DeepSeek key only in Android encrypted storage.
- Persist books, cards, messages, generation cursor, favorites, reading position, and TTS cache metadata locally.
- Use UTF-8 for all project text files.
- Generate at most 20 cards in one batch and persist cursor advancement transactionally.

---

## File Structure

- `book-concept-app/android-app/src/domain/`: stable TypeScript models and validation.
- `book-concept-app/android-app/src/data/`: SQLite schema, repositories, encrypted settings, and file import.
- `book-concept-app/android-app/src/deepseek/`: prompts, API client, JSON repair, and generation coordinator.
- `book-concept-app/android-app/src/tts/`: text normalization, cache keys, native facade, and playback queue.
- `book-concept-app/android-app/src/ui/`: navigation, screens, and reusable mobile components.
- `book-concept-app/android-app/android/app/src/main/assets/tts/`: bundled ONNX model resources.
- `book-concept-app/scripts/`: repeatable Android environment and APK build scripts.

### Task 1: Bootstrap The Independent Android App

**Files:**
- Create: `book-concept-app/android-app/package.json`
- Create: `book-concept-app/android-app/tsconfig.json`
- Create: `book-concept-app/android-app/jest.config.js`
- Create: `book-concept-app/android-app/src/App.tsx`
- Create: `book-concept-app/android-app/src/__tests__/App.test.tsx`
- Create: `book-concept-app/scripts/check_android_environment.ps1`

**Interfaces:**
- Produces: a buildable React Native application named `MapToLearn` with package id `com.secondlalala.maptolearn`.
- Produces: `check_android_environment.ps1` that exits non-zero unless Node, JDK 17, Android SDK 35, and platform-tools are available.

- [ ] **Step 1: Write the failing shell/environment and root-render tests**

```tsx
import {render, screen} from '@testing-library/react-native';
import App from '../App';

test('shows the mobile library as the initial screen', () => {
  render(<App />);
  expect(screen.getByText('我的书库')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests and confirm the missing project fails**

Run: `cd book-concept-app/android-app; npm test -- --runInBand`

Expected: FAIL because the Android app and `App` module do not exist.

- [ ] **Step 3: Scaffold the bare React Native TypeScript project and pin dependencies**

Use the React Native Community CLI to create `android-app`, then set:

```json
{
  "name": "MapToLearn",
  "private": true,
  "scripts": {
    "android": "react-native run-android",
    "test": "jest",
    "lint": "eslint .",
    "assemble:debug": "cd android && gradlew.bat assembleDebug"
  }
}
```

Configure Gradle with `minSdkVersion = 29` and `reactNativeArchitectures=arm64-v8a`. Implement `App.tsx` with a `SafeAreaView` and the initial text `我的书库`.

- [ ] **Step 4: Add the deterministic environment checker**

```powershell
$ErrorActionPreference = "Stop"
node --version
java -version
if (-not $env:ANDROID_HOME) { throw "ANDROID_HOME is not configured" }
$sdkManager = Join-Path $env:ANDROID_HOME "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkManager)) { throw "Android command-line tools are missing" }
& $sdkManager --list | Select-String "platforms;android-35"
```

- [ ] **Step 5: Run the root test and Android debug compilation**

Run: `npm test -- --runInBand`

Expected: PASS for `App.test.tsx`.

Run: `npm run assemble:debug`

Expected: Gradle produces `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 6: Commit the bootstrap**

```bash
git add book-concept-app/android-app book-concept-app/scripts/check_android_environment.ps1
git commit -m "feat(android): bootstrap independent mobile app"
```

### Task 2: Define Domain Models And Local Database

**Files:**
- Create: `book-concept-app/android-app/src/domain/models.ts`
- Create: `book-concept-app/android-app/src/data/database.ts`
- Create: `book-concept-app/android-app/src/data/repositories.ts`
- Create: `book-concept-app/android-app/src/data/__tests__/repositories.test.ts`

**Interfaces:**
- Produces: `Book`, `OutlineNode`, `ConceptCard`, `ChatMessage`, and `GenerationState` types.
- Produces: `openDatabase(): Promise<Database>`.
- Produces: `bookRepository`, `cardRepository`, `chatRepository`, and `generationRepository`.
- Produces: `saveCardsAndAdvance(sectionId, cards, nextChunkIndex): Promise<void>`.

- [ ] **Step 1: Write failing repository tests**

```ts
it('rolls back cards when cursor advancement fails', async () => {
  await db.execute('INSERT INTO sections(id, book_id, title, status, chunk_index) VALUES (?, ?, ?, ?, ?)', ['s1', 'b1', '第一节', 'queued', 0]);
  await expect(
    repositories.saveCardsAndAdvance('s1', [cardFixture], -1),
  ).rejects.toThrow();
  expect(await repositories.listCards('b1')).toEqual([]);
});
```

- [ ] **Step 2: Run the database tests and verify failure**

Run: `npm test -- src/data/__tests__/repositories.test.ts --runInBand`

Expected: FAIL because repositories and schema do not exist.

- [ ] **Step 3: Implement versioned SQLite migrations**

Create tables `books`, `outline_nodes`, `cards`, `chat_messages`, `generation_state`, and `tts_cache`. Store arrays as JSON text and booleans as integer values. Set `PRAGMA foreign_keys = ON` and `PRAGMA user_version = 1`.

- [ ] **Step 4: Implement typed repositories and transaction boundaries**

```ts
export async function saveCardsAndAdvance(
  sectionId: string,
  cards: ConceptCard[],
  nextChunkIndex: number,
): Promise<void> {
  if (nextChunkIndex < 0) throw new Error('Invalid generation cursor');
  await db.transaction(async tx => {
    for (const card of cards) await insertCard(tx, card);
    await tx.execute(
      'UPDATE outline_nodes SET status = ?, chunk_index = ? WHERE id = ?',
      ['completed', nextChunkIndex, sectionId],
    );
  });
}
```

- [ ] **Step 5: Run repository tests**

Run: `npm test -- src/data/__tests__/repositories.test.ts --runInBand`

Expected: PASS, including migration and rollback cases.

- [ ] **Step 6: Commit local persistence**

```bash
git add book-concept-app/android-app/src/domain book-concept-app/android-app/src/data
git commit -m "feat(android): add local SQLite persistence"
```

### Task 3: Import Markdown And TXT With Structured Outlines

**Files:**
- Create: `book-concept-app/android-app/src/import/textDecoder.ts`
- Create: `book-concept-app/android-app/src/import/outlineParser.ts`
- Create: `book-concept-app/android-app/src/import/importBook.ts`
- Create: `book-concept-app/android-app/src/import/__tests__/outlineParser.test.ts`

**Interfaces:**
- Produces: `decodeBook(bytes: Uint8Array): DecodedBook`.
- Produces: `parseOutline(text: string): ParsedSection[]`.
- Produces: `splitOversizedSection(section, maxChars = 6000): ParsedChunk[]`.
- Produces: `importBook(uri: string): Promise<Book>`.

- [ ] **Step 1: Write failing parsing and split tests**

```ts
it('keeps chapter and subsection hierarchy', () => {
  const result = parseOutline('# 第一章\n导言\n## 1.1 场\n正文');
  expect(result.map(x => [x.level, x.title])).toEqual([
    [1, '第一章'],
    [2, '1.1 场'],
  ]);
});

it('splits long sections only at paragraph boundaries', () => {
  const chunks = splitOversizedSection({id: 's', text: '甲。\n\n乙。'}, 3);
  expect(chunks.map(x => x.text)).toEqual(['甲。', '乙。']);
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run: `npm test -- src/import/__tests__/outlineParser.test.ts --runInBand`

Expected: FAIL because parser functions do not exist.

- [ ] **Step 3: Implement decoding, hierarchy parsing, and bounded splitting**

Accept only case-insensitive `.md` and `.txt`. Decode valid UTF-8 directly; use `jschardet` only after UTF-8 validation fails. Recognize Markdown headings and numbered Chinese/English chapter headings. Preserve source offsets.

- [ ] **Step 4: Implement document-picker import**

Use Android's Storage Access Framework through a maintained document picker. Copy bytes to the app-private documents directory, insert the book and outline in one transaction, and reject unsupported extensions before writing.

- [ ] **Step 5: Run parser and import tests**

Run: `npm test -- src/import --runInBand`

Expected: PASS for UTF-8 Chinese, fallback encoding, hierarchy, size limits, and unsupported files.

- [ ] **Step 6: Commit import support**

```bash
git add book-concept-app/android-app/src/import
git commit -m "feat(android): import books and build outlines"
```

### Task 4: Implement Secure DeepSeek Generation

**Files:**
- Create: `book-concept-app/android-app/src/settings/secureSettings.ts`
- Create: `book-concept-app/android-app/src/deepseek/prompts.ts`
- Create: `book-concept-app/android-app/src/deepseek/cardSchema.ts`
- Create: `book-concept-app/android-app/src/deepseek/client.ts`
- Create: `book-concept-app/android-app/src/deepseek/generator.ts`
- Create: `book-concept-app/android-app/src/deepseek/__tests__/generator.test.ts`

**Interfaces:**
- Produces: `getDeepSeekSettings()` and `setDeepSeekSettings(settings)` backed by Android Keystore encryption.
- Produces: `generateSection(sectionId: string): Promise<GenerationResult>`.
- Produces: `generateNextSection(bookId: string): Promise<GenerationResult | null>`.
- Produces: `askCard(cardId: string, question: string): Promise<ChatMessage>`.

- [ ] **Step 1: Write failing strict-JSON and recovery tests**

```ts
it('repairs invalid JSON once then persists cards and cursor', async () => {
  transport.enqueue('not json');
  transport.enqueue(JSON.stringify([cardFixture]));
  await generator.generateSection('s1');
  expect(transport.calls).toHaveLength(2);
  expect(await repositories.listCards('b1')).toHaveLength(1);
  expect(await repositories.getGenerationState('s1')).toMatchObject({status: 'completed'});
});
```

- [ ] **Step 2: Run generator tests and verify failure**

Run: `npm test -- src/deepseek/__tests__/generator.test.ts --runInBand`

Expected: FAIL because the DeepSeek client and generator do not exist.

- [ ] **Step 3: Implement prompts and schema validation**

Require one chapter/section introduction card first, followed by coherent concepts. Require strict JSON, no more than 20 cards, and LaTeX in `formula` and formula-bearing answers. Validate all fields before persistence.

- [ ] **Step 4: Implement API transport with bounded retry**

POST to `https://api.deepseek.com/chat/completions`. Retry HTTP 429 and transient 5xx responses up to three attempts with 1, 2, and 4 second delays. Never log request headers, API keys, or complete source text.

- [ ] **Step 5: Implement transactional generation and chat**

Set section status to `generating`, call DeepSeek, attempt one JSON repair call, and invoke `saveCardsAndAdvance`. On failure set `failed` without changing the previous cursor. Persist user and assistant chat messages.

- [ ] **Step 6: Run DeepSeek service tests**

Run: `npm test -- src/deepseek --runInBand`

Expected: PASS for success, repair, rate limit, missing key, and cursor preservation.

- [ ] **Step 7: Commit DeepSeek integration**

```bash
git add book-concept-app/android-app/src/settings book-concept-app/android-app/src/deepseek
git commit -m "feat(android): generate cards with DeepSeek"
```

### Task 5: Build The Mobile Library, Outline, And Reader

**Files:**
- Create: `book-concept-app/android-app/src/ui/navigation/AppNavigator.tsx`
- Create: `book-concept-app/android-app/src/ui/screens/LibraryScreen.tsx`
- Create: `book-concept-app/android-app/src/ui/screens/ReaderScreen.tsx`
- Create: `book-concept-app/android-app/src/ui/screens/FavoritesScreen.tsx`
- Create: `book-concept-app/android-app/src/ui/screens/SettingsScreen.tsx`
- Create: `book-concept-app/android-app/src/ui/components/OutlineDrawer.tsx`
- Create: `book-concept-app/android-app/src/ui/components/ConceptCard.tsx`
- Create: `book-concept-app/android-app/src/ui/__tests__/ReaderScreen.test.tsx`

**Interfaces:**
- Consumes: repositories, import service, settings, `generateNextSection`.
- Produces: bottom-tab navigation and full-screen vertical card paging.
- Produces: immediate next-section generation when a section becomes active.

- [ ] **Step 1: Write failing reader behavior tests**

```tsx
it('resumes the last card and starts the next section immediately', async () => {
  repositories.getLastReadCard.mockResolvedValue('card-3');
  render(<ReaderScreen bookId="b1" />);
  await waitFor(() => expect(screen.getByTestId('card-card-3')).toBeTruthy());
  expect(generator.generateNextSection).toHaveBeenCalledWith('b1');
});
```

- [ ] **Step 2: Run UI tests and verify failure**

Run: `npm test -- src/ui/__tests__/ReaderScreen.test.tsx --runInBand`

Expected: FAIL because the mobile screens do not exist.

- [ ] **Step 3: Implement compact mobile navigation and library**

Use icon-based bottom tabs for Library, Reader, Favorites, and Settings. Library rows show book title, card count, generation state, and a resume action. Avoid desktop two-column layouts.

- [ ] **Step 4: Implement vertical card paging and reading persistence**

Use a full-height vertical `FlatList` with `pagingEnabled`, stable item dimensions, and `getItemLayout`. Save the visible card id after paging settles.

- [ ] **Step 5: Implement collapsible outline drawer and progress**

Render nested chapter/section nodes in a left drawer. Show queued, generating, completed, and failed states. Opening a section scrolls to its first card. Reading a section invokes `generateNextSection` immediately without an eight-second delay.

- [ ] **Step 6: Implement favorites and settings screens**

Favorites queries local SQLite. Settings edits DeepSeek parameters, TTS voice, speed from 0.2 to 2.0, preload, and cache clearing.

- [ ] **Step 7: Run UI tests**

Run: `npm test -- src/ui --runInBand`

Expected: PASS for resume, paging, background generation trigger, outline states, favorites, and settings.

- [ ] **Step 8: Commit mobile UI**

```bash
git add book-concept-app/android-app/src/ui book-concept-app/android-app/src/App.tsx
git commit -m "feat(android): add mobile library and card reader"
```

### Task 6: Render LaTeX And Card-Bound Chat

**Files:**
- Create: `book-concept-app/android-app/src/ui/components/RichText.tsx`
- Create: `book-concept-app/android-app/src/ui/components/ChatSheet.tsx`
- Create: `book-concept-app/android-app/src/ui/components/__tests__/RichText.test.tsx`
- Create: `book-concept-app/android-app/src/ui/components/__tests__/ChatSheet.test.tsx`

**Interfaces:**
- Produces: `RichText({content})` supporting `$...$` and `$$...$$`.
- Produces: `ChatSheet({cardId})` with local history and recommended-question actions.

- [ ] **Step 1: Write failing formula fallback tests**

```tsx
it('shows source text when a formula cannot be compiled', () => {
  render(<RichText content={'$$\\broken{'} />);
  expect(screen.getByText('\\broken{')).toBeTruthy();
});
```

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm test -- src/ui/components/__tests__ --runInBand`

Expected: FAIL because rich text and chat components do not exist.

- [ ] **Step 3: Implement constrained KaTeX rendering**

Use a local HTML template in `react-native-webview` with bundled KaTeX assets, JavaScript disabled after initial rendering, transparent background, and measured content height. Catch KaTeX failures and render the original expression as selectable text.

- [ ] **Step 4: Implement readable chat layout**

Use separate user and assistant message styles, selectable assistant text, formula rendering, input safe-area padding, sending/error states, and recommended-question chips. Bind all calls and history to the current `cardId`.

- [ ] **Step 5: Run formula and chat tests**

Run: `npm test -- src/ui/components/__tests__ --runInBand`

Expected: PASS for inline formulas, display formulas, malformed fallback, history, and recommended questions.

- [ ] **Step 6: Commit formula and chat UI**

```bash
git add book-concept-app/android-app/src/ui/components
git commit -m "feat(android): render formulas and card chat"
```

### Task 7: Bundle Offline Chinese TTS And Audio Cache

**Files:**
- Create: `book-concept-app/android-app/src/tts/normalizeText.ts`
- Create: `book-concept-app/android-app/src/tts/cache.ts`
- Create: `book-concept-app/android-app/src/tts/TtsService.ts`
- Create: `book-concept-app/android-app/src/tts/__tests__/normalizeText.test.ts`
- Create: `book-concept-app/android-app/android/app/src/main/java/com/secondlalala/maptolearn/tts/SherpaTtsModule.kt`
- Create: `book-concept-app/android-app/android/app/src/main/java/com/secondlalala/maptolearn/tts/SherpaTtsPackage.kt`
- Create: `book-concept-app/android-app/android/app/src/main/assets/tts/sherpa-onnx-vits-zh-ll/`

**Interfaces:**
- Produces: native `preload(): Promise<void>`, `synthesize(text, voice, speed, outputPath): Promise<string>`, and `unload(): Promise<void>`.
- Produces: `speak(request: SpeechRequest): Promise<void>`.
- Produces: deterministic SHA-256 cache keys from normalized text, voice, speed, and model version.

- [ ] **Step 1: Write failing normalization and cache tests**

```ts
it('keeps sentence boundaries and converts colon to Chinese comma', () => {
  expect(normalizeForTts('标题：“量子场”；下一句。')).toEqual([
    '标题，量子场，下一句。',
  ]);
});

it('changes the key when speed changes', async () => {
  expect(await speechCacheKey({...request, speed: 0.8}))
    .not.toBe(await speechCacheKey({...request, speed: 1.0}));
});
```

- [ ] **Step 2: Run TTS TypeScript tests and verify failure**

Run: `npm test -- src/tts --runInBand`

Expected: FAIL because normalization and cache services do not exist.

- [ ] **Step 3: Implement normalization, sentence queue, and WAV cache**

Preserve Chinese commas and periods, convert colons to Chinese commas, remove unsupported quote/bracket glyphs, split at sentence-ending periods, and pre-synthesize the next sentence before current playback finishes. Cache completed WAV files only; remove partial files on failure.

- [ ] **Step 4: Add Sherpa-ONNX Android runtime and native module**

Add the official ARM64 Sherpa-ONNX Android AAR/JNI runtime. Load the bundled VITS model lazily on a single background executor. Emit loading and synthesis progress to React Native. Write PCM output as a valid WAV file in the requested app-private cache path.

- [ ] **Step 5: Bundle and verify the complete Chinese model**

Place `model.onnx`, tokens, lexicon, dictionary, phone/date normalization FST files, and model config beneath the TTS asset directory. Add a Gradle verification task that fails when a required asset is absent or zero bytes.

- [ ] **Step 6: Add Android system-TTS fallback**

If native initialization fails, use Android `TextToSpeech` for the current session and display a non-blocking fallback status. Do not replace or delete the bundled model.

- [ ] **Step 7: Run TTS tests and native smoke test**

Run: `npm test -- src/tts --runInBand`

Expected: PASS for normalization, cache identity, cache reuse, and failure cleanup.

Run on ARM64 emulator/device: `gradlew.bat connectedDebugAndroidTest`

Expected: model preloads and a non-empty WAV beginning with `RIFF` is produced.

- [ ] **Step 8: Commit offline speech**

```bash
git add book-concept-app/android-app/src/tts book-concept-app/android-app/android/app/src/main
git commit -m "feat(android): bundle offline Chinese speech"
```

### Task 8: Build, Install, And Document The APK

**Files:**
- Create: `book-concept-app/scripts/build_android_apk.ps1`
- Create: `book-concept-app/android-app/README.md`
- Modify: `book-concept-app/README.md`
- Create: `book-concept-app/android-app/e2e/android-smoke.md`

**Interfaces:**
- Produces: `book-concept-app/android-app/android/app/build/outputs/apk/debug/app-debug.apk`.
- Produces: a repeatable build command and device-install command.

- [ ] **Step 1: Add a failing artifact assertion to the build script**

```powershell
$apk = Join-Path $PSScriptRoot "..\android-app\android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apk)) { throw "APK was not produced: $apk" }
if ((Get-Item $apk).Length -lt 100MB) { throw "APK is too small to contain the bundled TTS model" }
```

- [ ] **Step 2: Run the script before implementation and verify failure**

Run: `powershell -ExecutionPolicy Bypass -File book-concept-app/scripts/build_android_apk.ps1`

Expected: FAIL because the complete build script or APK does not exist.

- [ ] **Step 3: Implement clean test and build orchestration**

The script runs the environment checker, `npm ci`, `npm test -- --runInBand`, Gradle `clean assembleDebug`, and the artifact assertions. It prints the absolute APK path and SHA-256 checksum.

- [ ] **Step 4: Document setup, installation, and signing**

Document JDK 17, Android SDK 35, `ANDROID_HOME`, proxy port 7897 for dependency failures, USB debugging, `adb install -r`, DeepSeek key setup, local-data behavior, model size, and debug versus release signing.

- [ ] **Step 5: Run full Android and existing web verification**

Run: `powershell -ExecutionPolicy Bypass -File book-concept-app/scripts/build_android_apk.ps1`

Expected: all tests pass and the APK checksum is printed.

Run: `cd book-concept-app/frontend; npm run build`

Expected: existing web frontend builds without source changes.

Run: `book-concept-app/backend/.venv/Scripts/python.exe -m unittest discover book-concept-app/backend/tests`

Expected: existing backend tests pass.

- [ ] **Step 6: Install and execute the acceptance checklist**

Run: `adb install -r book-concept-app/android-app/android/app/build/outputs/apk/debug/app-debug.apk`

Verify import, restart persistence, DeepSeek generation, vertical paging, immediate next-section generation, formulas, chat, Chinese offline TTS, and cached replay on an ARM64 Android 10+ device.

- [ ] **Step 7: Commit build and documentation**

```bash
git add book-concept-app/scripts/build_android_apk.ps1 book-concept-app/android-app/README.md book-concept-app/android-app/e2e/android-smoke.md book-concept-app/README.md
git commit -m "build(android): produce installable APK"
```
