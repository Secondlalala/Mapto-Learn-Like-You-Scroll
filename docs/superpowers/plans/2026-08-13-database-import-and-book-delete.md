# Database Import And Book Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import MapToLearn SQLite exports as independent book copies, safely delete one selected book, and prove the workflow with the current qft data.

**Architecture:** A focused `database_transfer` service validates untrusted SQLite files in read-only mode, remaps Book/Card/Message IDs, and writes through the caller's SQLAlchemy transaction. FastAPI routers own upload limits, commits, JSON errors, and deletion conflict checks. React adds one import control on the library page and a title-confirmed deletion dialog on the book page.

**Tech Stack:** FastAPI, SQLAlchemy, SQLite, pytest, React 18, Vite, existing Tailwind utility classes.

## Global Constraints

- Scheme A is mandatory: every import creates new books and new primary keys; existing books are never merged or overwritten.
- Accept `.db`, `.sqlite`, and `.sqlite3`; reject files larger than 200 MB.
- Import only Book, ConceptCard, and ChatMessage; ignore GenerationJob and runtime settings.
- Import must be all-or-nothing and must remove its temporary upload file.
- Delete only one selected book after exact-title confirmation; never delete the physical `app.db`.
- The real qft database must remain unchanged during round-trip verification.

---

### Task 1: SQLite Import Service

**Files:**
- Create: `book-concept-app/backend/services/database_transfer.py`
- Test: `book-concept-app/backend/tests/test_database_import.py`

**Interfaces:**
- Produces: `ImportValidationError(ValueError)` and `import_database_file(db: Session, source_path: Path) -> ImportResult`.
- `ImportResult` fields: `book_ids`, `books`, `cards`, `messages`.

- [ ] **Step 1: Write failing duplicate-import and relationship tests**

Create an exported source database with one Book, two ConceptCards, and one ChatMessage. Call `import_database_file` twice into a separate target database and assert two new book IDs, four target cards, two target messages, and valid remapped relationships.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `backend/.venv/Scripts/python.exe -m pytest tests/test_database_import.py -q` from `book-concept-app/backend`.

Expected: collection failure because `services.database_transfer` does not exist.

- [ ] **Step 3: Implement read-only validation and ID remapping**

Implement these boundaries:

```python
@dataclass(frozen=True)
class ImportResult:
    book_ids: list[int]
    books: int
    cards: int
    messages: int

def import_database_file(db: Session, source_path: Path) -> ImportResult:
    source = sqlite3.connect(f"file:{source_path.as_posix()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    # validate required tables/columns and source relationships
    # db.add + db.flush Book copies, then Card copies, then Message copies
    # never call db.commit here
```

Normalize JSON arrays to `[]` on invalid input and parse ISO datetimes with a UTC-now fallback. Raise `ImportValidationError` for non-SQLite files, missing columns, orphan cards, or orphan messages.

- [ ] **Step 4: Add invalid-file and rollback tests**

Assert malformed SQLite and missing-table files raise `ImportValidationError`; assert the caller can roll back and leave the target with zero books.

- [ ] **Step 5: Run focused and complete backend tests**

Run: `backend/.venv/Scripts/python.exe -m pytest tests/test_database_import.py -q` and then `backend/.venv/Scripts/python.exe -m pytest tests -q`.

- [ ] **Step 6: Commit**

Commit message: `feat: import card databases with id remapping`.

### Task 2: Import HTTP API

**Files:**
- Create: `book-concept-app/backend/routers/imports.py`
- Modify: `book-concept-app/backend/schemas.py`
- Modify: `book-concept-app/backend/main.py`
- Test: `book-concept-app/backend/tests/test_database_import_api.py`

**Interfaces:**
- Consumes: `import_database_file` and `ImportValidationError` from Task 1.
- Produces: `POST /api/imports/database` and `DatabaseImportOut` JSON.

- [ ] **Step 1: Write failing multipart API tests**

Upload a valid `.db` and assert status 200 plus exact import counts. Upload `.txt`, oversized streamed content, and malformed `.db`; assert JSON status 400/413 and no target records.

- [ ] **Step 2: Run focused API tests and verify RED**

Expected: 404 because the import router is not registered.

- [ ] **Step 3: Implement bounded temporary upload and transaction ownership**

The route reads `UploadFile` in 1 MB chunks, stops above `200 * 1024 * 1024`, writes only to `tempfile.TemporaryDirectory`, calls the service, commits on success, rolls back on every exception, and returns:

```python
class DatabaseImportOut(BaseModel):
    imported_book_ids: list[int]
    imported_books: int
    imported_cards: int
    imported_messages: int
    message: str
```

- [ ] **Step 4: Register the router and run tests**

Run focused API tests, then all backend tests.

- [ ] **Step 5: Commit**

Commit message: `feat: expose database import api`.

### Task 3: Confirmed Single-Book Deletion

**Files:**
- Modify: `book-concept-app/backend/routers/books.py`
- Modify: `book-concept-app/backend/schemas.py`
- Test: `book-concept-app/backend/tests/test_book_delete.py`

**Interfaces:**
- Produces: `DELETE /api/books/{book_id}` consuming `BookDeleteIn(confirmation_title: str)` and returning `BookDeleteOut` counts.

- [ ] **Step 1: Write failing deletion tests**

Assert exact-title deletion removes one Book, its ConceptCards and ChatMessages while preserving a second book. Assert mismatched title returns 400 and a queued/running GenerationJob containing the book returns 409.

- [ ] **Step 2: Run focused tests and verify RED**

Expected: 405 because no DELETE route exists.

- [ ] **Step 3: Implement conflict check and atomic delete**

Parse `GenerationJob.book_ids_json` for jobs with status `queued` or `running`. If target ID appears, return 409. Count related messages/cards, delete them and the Book in one transaction, then return counts.

- [ ] **Step 4: Run focused and complete backend tests**

Run: `backend/.venv/Scripts/python.exe -m pytest tests/test_book_delete.py -q`, then all backend tests.

- [ ] **Step 5: Commit**

Commit message: `feat: add confirmed single-book deletion`.

### Task 4: Web Import And Delete Controls

**Files:**
- Modify: `book-concept-app/frontend/src/api/client.js`
- Modify: `book-concept-app/frontend/src/pages/UploadPage.jsx`
- Create: `book-concept-app/frontend/src/components/DeleteBookDialog.jsx`
- Modify: `book-concept-app/frontend/src/pages/BookPage.jsx`
- Modify: `book-concept-app/frontend/src/App.jsx`

**Interfaces:**
- Consumes: `POST /api/imports/database` and `DELETE /api/books/{book_id}`.
- Produces: homepage `.db` file chooser and title-confirmed deletion modal.

- [ ] **Step 1: Add API client methods**

`importDatabase(file)` sends FormData field `file`. `deleteBook(bookId, confirmationTitle)` sends JSON `{confirmation_title: confirmationTitle}`.

- [ ] **Step 2: Add homepage import control**

Use a Database icon button labeled `导入卡片数据库` with hidden file input `accept=".db,.sqlite,.sqlite3"`. Show counts after success and call `onBooksChanged`.

- [ ] **Step 3: Add deletion dialog and navigation**

Dialog displays book title and card count, requires exact title input, disables confirmation until matched, then calls `onDeleted(bookId)`. App refreshes books, clears `reader-progress-{bookId}`, and returns to library.

- [ ] **Step 4: Build and visually verify**

Run `npm run build` from the real `D:\Codex\...\frontend` path. In the local browser verify file filtering, import summary, exact-title button enablement, cancel, and successful navigation using a temporary backend database.

- [ ] **Step 5: Commit**

Commit message: `feat: add database import and deletion controls`.

### Task 5: qft Export And Round-Trip Proof

**Files:**
- Create runtime artifact (Git-ignored): `book-concept-app/exports/qft-card-database.db`
- Test: reuse `backend/tests/test_database_import.py` plus a one-off read-only verification command.

- [ ] **Step 1: Export qft from the real database**

Use the same book-export routine as `GET /api/books/1/export-database` to write the durable artifact. Do not modify `backend/app.db`.

- [ ] **Step 2: Record source counts**

Read qft source counts: one book, 18 cards, 2 messages, 0 favorites, cursor 15.

- [ ] **Step 3: Import twice into an empty temporary target**

Assert two books, 36 cards, 4 messages, distinct Book/Card IDs, and all foreign-key relationships target the corresponding new copies.

- [ ] **Step 4: Delete one imported copy**

Use the production deletion path and assert one book, 18 cards, and 2 messages remain.

- [ ] **Step 5: Verify real database unchanged**

Re-read `backend/app.db`; assert it still has exactly one qft with 18 cards and 2 messages.

### Task 6: Final Regression And Delivery

**Files:**
- Verify all modified files and Git-ignored qft artifact.

- [ ] **Step 1: Run fresh regression suite**

Run backend pytest, Web Vite production build, Android `npm test -- --runInBand`, and `git diff --check`.

- [ ] **Step 2: Inspect artifact integrity**

Open `qft-card-database.db` with SQLite read-only and report its size and exact table counts.

- [ ] **Step 3: Push through the configured proxy**

Push `apk-development` using `http://127.0.0.1:7897`; the ignored qft database remains local and is reported by absolute path.
