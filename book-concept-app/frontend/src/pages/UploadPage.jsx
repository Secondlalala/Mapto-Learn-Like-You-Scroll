import { useRef, useState } from "react";
import { Database, FileText, Sparkles, Upload } from "lucide-react";
import { api } from "../api/client";
import GenerationJobStatus from "../components/GenerationJobStatus";
import UploadBox from "../components/UploadBox";
import useGenerationJob from "../hooks/useGenerationJob";

export default function UploadPage({ books, onUploaded, onOpenBook, onBooksChanged }) {
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const databaseInputRef = useRef(null);
  const generation = useGenerationJob({ onProgress: onBooksChanged });

  const upload = async (file) => {
    // busy 同时禁止重复选择文件；无论成功失败都在 finally 中恢复可操作状态。
    setBusy(true);
    setError("");
    try {
      const data = await api.uploadBook(file);
      // 上传成功后由父组件刷新书库并跳转书籍详情，不在本页复制导航状态。
      onUploaded(data.book_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startAllBooks = async () => {
    setActionBusy(true);
    setError("");
    try {
      const job = await generation.startAllBooks();
      setMessage(job.status === "completed" ? "当前书库没有待生成的小节。" : "已加入全应用后台生成队列。可继续浏览或阅读。");
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  };

  const downloadApplicationDatabase = async () => {
    setActionBusy(true);
    setError("");
    try {
      const filename = await api.downloadApplicationDatabase();
      setMessage(`已开始下载 ${filename}，包含应用内全部书籍、卡片、收藏与追问记录。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  };

  const importDatabase = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setActionBusy(true);
    setError("");
    setMessage("正在校验并导入数据库...");
    try {
      const data = await api.importDatabase(file);
      await onBooksChanged?.();
      setMessage(
        `导入完成：新增 ${data.imported_books} 本书、${data.imported_cards} 张卡片和 ${data.imported_messages} 条追问。原有书库未被覆盖。`,
      );
    } catch (err) {
      setError(err.message);
      setMessage("");
    } finally {
      setActionBusy(false);
      event.target.value = "";
    }
  };

  const pauseOrResume = async (action) => {
    setActionBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <section className="mx-auto grid min-h-[calc(100vh-56px)] max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="flex flex-col justify-center gap-5">
        <div>
          <h1 className="text-3xl font-bold tracking-normal text-stone-950 sm:text-4xl">上传一本书，生成可追问的概念卡片</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
            支持 Markdown 和 TXT。系统会切分章节、提取核心概念，并生成解释、寓言、公式、前置知识和推荐问题。
          </p>
        </div>
        <UploadBox busy={busy} onUpload={upload} />
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      <aside className="py-2">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-normal text-stone-500">已上传书籍</h2>
          <div className="flex flex-wrap gap-2">
            <input
              ref={databaseInputRef}
              className="hidden"
              type="file"
              accept=".db,.sqlite,.sqlite3"
              onChange={importDatabase}
            />
            <button
              className="inline-flex h-9 items-center gap-2 border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
              onClick={() => databaseInputRef.current?.click()}
              disabled={actionBusy}
              title="导入独立卡片数据库；每次导入都创建新书，不覆盖现有内容"
            >
              <Upload size={15} />
              导入卡片数据库
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
              onClick={startAllBooks}
              disabled={actionBusy || generation.isRunning || !books.length}
              title="从所有书籍各自保存的进度继续，依次生成剩余小节"
            >
              <Sparkles size={15} />
              生成全部书籍
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 border border-stone-300 bg-white px-3 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
              onClick={downloadApplicationDatabase}
              disabled={actionBusy}
              title="导出完整 app.db，包含全部书籍和学习记录"
            >
              <Database size={15} />
              导出全部应用数据库
            </button>
          </div>
        </div>
        <p className="mb-3 text-xs leading-5 text-stone-500">导入数据库会新增独立书籍副本，不覆盖现有内容；导出的 `.db` 包含应用内全部书籍、卡片、收藏和追问记录。</p>
        <GenerationJobStatus
          job={generation.job}
          bookTitle={books.find((book) => book.id === generation.job?.current_book_id)?.title}
          onPause={() => pauseOrResume(generation.pause)}
          onResume={() => pauseOrResume(generation.resume)}
          actionBusy={actionBusy}
        />
        {generation.error && <p className="mt-3 text-sm text-red-700">{generation.error}</p>}
        {message && <p className="mt-3 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">{message}</p>}
        <div className="mt-3 space-y-3">
          {books.map((book) => (
            <button
              key={book.id}
              className="flex w-full items-center justify-between rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm hover:border-stone-400"
              onClick={() => onOpenBook(book.id)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <FileText className="shrink-0 text-stone-500" size={20} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-stone-900">{book.title}</span>
                  <span className="text-sm text-stone-500">{book.file_type} · {book.card_count} 张卡片</span>
                </span>
              </span>
            </button>
          ))}
          {!books.length && <p className="rounded-md border border-dashed border-stone-300 p-4 text-sm text-stone-500">还没有上传记录。</p>}
        </div>
      </aside>
    </section>
  );
}
