# Android APK Design

## Goal

Build an installable Android application for the book concept learning product while preserving the existing desktop web application unchanged. The two clients are maintained independently but keep compatible concept-card fields and DeepSeek prompts.

## Product Boundary

- Keep `book-concept-app/frontend/` as the desktop-oriented web client.
- Keep `book-concept-app/backend/` as the web and Windows backend.
- Create `book-concept-app/android-app/` as an independent React Native Android project.
- Target Android 10 (API 29) or newer.
- Ship only the `arm64-v8a` ABI.
- The APK must remain usable without the desktop FastAPI service.

## Architecture

The Android app owns its presentation, persistence, document parsing, DeepSeek integration, and speech playback. React Native provides the mobile UI. Native Android integrations provide encrypted settings storage, SQLite, file selection, audio files, and Sherpa-ONNX inference.

The existing web application remains on its current React, FastAPI, SQLite, and Kokoro implementation. Shared behavior is maintained through documented JSON schemas and prompt templates rather than source-level imports across the two frontends.

## Mobile Navigation

The app uses a compact bottom navigation bar with four destinations:

- Library: imported books, upload action, generation status, and resume-reading entry.
- Reader: one full-screen concept card at a time with vertical paging.
- Favorites: locally saved favorite cards.
- Settings: DeepSeek API credentials, model parameters, TTS voice, speed, and cache management.

The reader exposes the book outline through a left-side drawer. Chapters and sections are collapsible. The currently visible card and currently generating section are highlighted.

## Local Data

SQLite is the source of truth on Android. It stores:

- Books and original UTF-8 text.
- Chapter and section outline nodes.
- Concept cards and source excerpts.
- Chat messages.
- Favorites.
- Last-read card and scroll position.
- Per-section generation cursor and status.
- TTS cache metadata.

Imported `.md` and `.txt` files are copied into the app-private directory. Text decoding tries UTF-8 first and uses explicit fallback detection without rewriting the original bytes.

Database migrations run at application startup. Uninstalling the APK removes local data unless Android backup restores it. A later export feature is outside this MVP.

## DeepSeek Integration

The Android app calls the DeepSeek cloud API directly over HTTPS. It does not route requests through the desktop backend.

The user enters the API key in Settings. The key is stored with Android encrypted storage and is never written to SQLite or application logs. API base URL, model, temperature, and timeout are configurable.

Generation follows the existing systematic workflow:

1. Parse the full document into chapters and sections.
2. Send one section at a time.
3. Split an oversized section into bounded sub-sections.
4. Generate an introductory card before detailed concept cards.
5. Generate no more than 20 cards in one batch.
6. Persist each successful card and advance the generation cursor transactionally.
7. Start the next section immediately while the user reads the current section.

The UI shows queued, generating, completed, and failed states in the outline. Failed jobs can be retried without deleting completed cards.

DeepSeek must return strict JSON. Formula fields and formula-bearing chat answers must use LaTeX delimiters. Invalid JSON is repaired once with a constrained follow-up request, then surfaced as a retryable error.

## Offline TTS

Sherpa-ONNX runs locally through an Android native module. The APK includes:

- ARM64 Sherpa-ONNX runtime libraries.
- A Chinese-capable VITS ONNX model.
- Required lexicons, phoneme data, and number/date normalization resources.

The initial model target is `sherpa-onnx-vits-zh-ll`, approximately 135 MB before APK packaging, with multiple Chinese voices. The implementation keeps model paths behind a TTS configuration interface so a Chinese-English MeloTTS model can replace it without changing reader components.

The model is loaded lazily on the first speech request. Settings includes a preload control. Speech generation runs off the UI thread and reports loading and synthesis progress.

Each generated WAV is stored in the app-private cache. Its key includes normalized text, voice, speed, model version, and synthesis settings. Repeated playback uses the cached file. Users can clear the cache from Settings.

The fable playback button reads only the fable. General card playback reads the title, one-sentence explanation, and the selected content section. Text normalization preserves sentence boundaries and converts unsuitable punctuation before inference.

## Formula Rendering

Cards and chat answers use a single rich-text renderer that recognizes inline and display LaTeX delimiters. Rendering occurs in a constrained mobile WebView or a maintained React Native math component. Malformed expressions display their source text instead of producing a blank region.

## Error Handling

- Missing DeepSeek key opens Settings with a clear action.
- Network failures preserve the current generation cursor and completed cards.
- API rate limits use bounded exponential retry and display the next retry state.
- Invalid files are rejected before database insertion.
- TTS initialization failures fall back to Android system TTS for the current session.
- Database writes for generated cards and cursor advancement are transactional.

No secret, complete book text, or generated speech content is written to diagnostic logs.

## Build And Distribution

The repository provides scripts for:

- Installing or locating JDK and Android SDK requirements.
- Running Android unit tests.
- Building a debug APK for local installation.
- Building a signed release APK after a signing keystore is supplied.

The TTS model is bundled as an Android asset or install-time asset pack according to final package-size verification. The delivered MVP artifact is an installable ARM64 debug APK. Release signing is documented but does not embed a repository-owned production key.

## Testing

- Unit tests cover outline parsing, generation cursor recovery, JSON validation, cache keys, and text normalization.
- Database tests cover migrations and transactional cursor advancement.
- Component tests cover library, settings, reader actions, and generation state.
- Native TTS smoke tests verify model initialization and WAV generation on ARM64 Android.
- An APK installation test verifies startup on Android 10 or newer.
- Existing web frontend and backend verification commands remain unchanged and must still pass.

## Acceptance Criteria

- Existing desktop web layout and behavior are unchanged.
- Android sources live only in `book-concept-app/android-app/` plus repository-level documentation and build scripts.
- The APK installs on an ARM64 Android 10+ device.
- A user can import Markdown or TXT, configure DeepSeek, generate and resume cards, ask questions, favorite cards, and browse vertically.
- Books, cards, messages, generation cursor, settings, and reading position survive app restarts.
- Chinese speech works without network access after installation.
- Repeated speech playback uses local cached WAV files.
- Formulae render legibly in cards and chat.

## Out Of Scope

- Synchronization between Android and desktop databases.
- PDF or EPUB import.
- User accounts and cloud backup.
- Google Play App Bundle publication.
- Fully offline language-model card generation.
