# 批量生成与数据库导出实施计划

> **给 Codex：** 实施本计划时使用 `superpowers:executing-plans`，逐项完成、测试并提交。

**目标：** 为 Web 版 MapToLearn 添加可恢复的后台批量卡片生成、完整应用与单书 SQLite 导出，并让书籍页卡片可直接跳转到阅读器。

**架构：** 使用一个持久化 `GenerationJob` 和进程内单 worker 串行调度既有的逐小节 `generate_cards_for_book`。生成数据仍由现有 Book/ConceptCard/ChatMessage 表保存；导出基于 SQLite backup API 或独立临时数据库。前端在首页和书籍页共享任务状态轮询，但各自只显示其需要的操作。

**技术栈：** FastAPI、SQLAlchemy、SQLite、pytest；React、Vite、现有 CSS；现有安卓 Jest 回归。

---

## 任务 1：建立任务数据模型与迁移

**文件：**
- 修改：`book-concept-app/backend/models.py`
- 修改：`book-concept-app/backend/database.py`
- 新增：`book-concept-app/backend/tests/test_generation_jobs.py`

**步骤：**
1. 先写失败测试：新数据库可创建 `GenerationJob`，并断言任务状态、进度、书籍顺序字段能往返保存。
2. 运行 `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_generation_jobs.py -q`，确认测试因模型缺失失败。
3. 在 `models.py` 增加 `GenerationJob`：scope、book_ids_json、status、当前书/位置、进度、卡片数、消息、错误和时间戳。
4. 在轻量 SQLite 迁移中为已有 `app.db` 创建缺失的 `generation_jobs` 表，保持已有数据不受影响。
5. 重跑该测试，确认通过。
6. 提交：`feat: persist batch generation jobs`。

## 任务 2：实现串行后台任务管理器

**文件：**
- 新增：`book-concept-app/backend/services/generation_manager.py`
- 修改：`book-concept-app/backend/main.py`
- 修改：`book-concept-app/backend/services/card_generator.py`
- 修改：`book-concept-app/backend/tests/test_generation_jobs.py`

**步骤：**
1. 先补失败测试：启动任务会冻结书籍顺序；worker 每次只推进一小节；暂停保留游标；恢复从游标继续；启动恢复把遗留 running/queued 标为 paused。
2. 运行任务测试，确认新 API/服务尚不存在。
3. 新建单例 manager，使用 `asyncio.Lock` 串行运行；每轮创建自己的 `SessionLocal`；调用现有生成器；更新持久化状态。
4. 为手动 `generate-cards` 提供同一把生成锁，避免阅读器预生成与批量 worker 竞争同一个 DeepSeek 调用和 SQLite 写入。
5. 在 FastAPI 启动时恢复遗留任务状态；在新任务、暂停和恢复时按设计启动/控制 worker。
6. 重跑任务测试，确认通过。
7. 提交：`feat: add resumable generation worker`。

## 任务 3：增加任务与导出 HTTP API

**文件：**
- 新增：`book-concept-app/backend/routers/generation_jobs.py`
- 新增：`book-concept-app/backend/routers/exports.py`
- 修改：`book-concept-app/backend/main.py`
- 修改：`book-concept-app/backend/routers/books.py`
- 新增：`book-concept-app/backend/tests/test_exports.py`

**步骤：**
1. 先写失败 API 测试：全书/单书创建、当前状态、暂停/继续、无书或无待处理内容的 JSON 行为。
2. 先写失败导出测试：完整导出能用 sqlite 打开；单书导出只含目标 Book、其卡片和追问记录，且没有其他 Book。
3. 实现 API router，使用明确的 HTTP 错误码和 JSON 错误内容。
4. 完整导出用 `sqlite3.Connection.backup` 在临时路径创建一致性快照；单书导出创建新 schema 后只复制目标关联记录，下载完由响应后台任务清理。
5. 将 routers 注册到应用，手动生成端点改为共享 manager 锁。
6. 运行两组新测试，确认通过。
7. 提交：`feat: expose generation jobs and database exports`。

## 任务 4：扩展前端 API 和可复用队列状态

**文件：**
- 修改：`book-concept-app/frontend/src/api/client.js`
- 新增：`book-concept-app/frontend/src/hooks/useGenerationJob.js`
- 修改：`book-concept-app/frontend/src/styles/index.css`

**步骤：**
1. 新增生成任务 CRUD 和数据库下载 API；下载时从响应头解析文件名并释放 blob URL。
2. 新增 `useGenerationJob`：1.5 秒轮询、卸载清理、仅在任务运行时继续轮询、封装启动/暂停/恢复/错误状态。
3. 为紧凑的任务状态、进度条和次要说明文本补充响应式 CSS，不能影响阅读器现有滑动布局。
4. 运行 `npm run build`，确认 lint/打包没有语法或导入问题。
5. 提交：`feat: add generation job client state`。

## 任务 5：首页和书籍页生成/导出入口

**文件：**
- 修改：`book-concept-app/frontend/src/pages/UploadPage.jsx`
- 修改：`book-concept-app/frontend/src/pages/BookPage.jsx`
- 修改：`book-concept-app/frontend/src/App.jsx`
- 修改：`book-concept-app/frontend/src/styles/index.css`

**步骤：**
1. 首页增加带范围说明的 `生成全部书籍` 与 `导出全部应用数据库 (.db)`；显示运行任务的当前书、小节进度、卡片数及暂停/继续。
2. 书籍页增加 `生成本书全部小节` 和 `导出本书数据库 (.db)`；仅把当前书的任务状态展示在主要位置。
3. 批量任务的按钮不调用 force，不删除已有卡片；保留原有“继续生成一节”和“从头生成”语义。
4. 任务轮询后刷新书籍/卡片计数，确保用户能看到后台新生成内容。
5. 运行 `npm run build`，并通过浏览器验证下载请求、状态展示和移动宽度布局。
6. 提交：`feat: add batch generation and export controls`。

## 任务 6：卡片直达阅读与回归验证

**文件：**
- 修改：`book-concept-app/frontend/src/pages/BookPage.jsx`
- 修改：`book-concept-app/frontend/src/pages/CardReaderPage.jsx`
- 修改：`book-concept-app/frontend/src/App.jsx`

**步骤：**
1. 将书籍页卡片摘要改为可访问的 button；点击时把 `bookId` 和 `cardId` 写入 reader route。
2. 阅读器接受可选 `targetCardId`。目标存在时先定位它；不存在或普通“开始阅读”时继续沿用 localStorage 上次进度。
3. 确认目标跳转不改变后续正常阅读进度记录。
4. 运行完整后端 `pytest backend/tests -q`、`npm run build`、安卓 `npm test -- --runInBand`。
5. 使用本地浏览器做一次针对现有书籍的手工验收：点卡片直达、普通开始阅读恢复、触发单书任务、导出单书数据库。
6. 提交：`feat: support direct card reading navigation`。

## 最终检查

1. `git diff --check`。
2. 确认运行中任务未被测试清空，现有 `app.db` 未改写为导出文件。
3. 检查 `.gitignore` 包含导出临时目录和数据库运行产物。
4. 汇总测试与手工验收结果；只有在用户要求时才推送这组功能提交。
