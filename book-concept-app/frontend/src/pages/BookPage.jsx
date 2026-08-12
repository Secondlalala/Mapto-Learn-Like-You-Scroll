import { useEffect, useState } from "react";
import { AlertTriangle, Database, Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../api/client";
import GenerationJobStatus from "../components/GenerationJobStatus";
import useGenerationJob from "../hooks/useGenerationJob";

export default function BookPage({ bookId, onRead, onBooksChanged }) {
  const [book, setBook] = useState(null);
  const [cards, setCards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    // 书籍元数据和卡片列表并行加载，页面标题、数量和按钮状态保持同一批数据。
    const [bookData, cardData] = await Promise.all([api.getBook(bookId), api.listCards(bookId)]);
    setBook(bookData);
    setCards(cardData);
  };
  const generation = useGenerationJob({
    onProgress: () => {
      load()
        .then(() => onBooksChanged?.())
        .catch((err) => setError(err.message));
    },
  });

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [bookId]);

  const generate = async ({ force = false } = {}) => {
    setBusy(true);
    setError("");
    setMessage(force ? "正在清空旧卡片，并从第一节重新生成..." : "正在按小节生成，单次最多 20 张卡片...");
    try {
      // force 模式由后端删除旧体系；前端同步清除旧卡片对应的阅读位置。
      const data = await api.generateCards(bookId, { force });
      if (force) localStorage.removeItem(`reader-progress-${bookId}`);
      await load();
      setMessage(`${data.message}：本次新增 ${data.generated} 张，进度 ${data.cursor}/${data.total_sections}。`);
    } catch (err) {
      setError(err.message);
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  const startBookGeneration = async () => {
    setActionBusy(true);
    setError("");
    try {
      const job = await generation.startBook(bookId);
      setMessage(job.status === "completed" ? "本书没有待生成的小节。" : "已加入本书后台生成队列，可继续浏览卡片。");
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
    }
  };

  const downloadBookDatabase = async () => {
    setActionBusy(true);
    setError("");
    try {
      const filename = await api.downloadBookDatabase(bookId);
      setMessage(`已开始下载 ${filename}，只包含当前书籍及其卡片、收藏和追问记录。`);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionBusy(false);
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

  if (!book) {
    return <div className="mx-auto max-w-4xl px-4 py-12 text-stone-500">加载中...</div>;
  }

  const jobBookIds = parseBookIds(generation.job?.book_ids_json);
  const jobAppliesToBook = generation.job && (generation.job.scope === "all_books" || jobBookIds.includes(bookId));
  const hasUnfinishedJob = generation.job && ["queued", "running", "paused"].includes(generation.job.status);

  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-stone-500">{book.filename}</p>
          <h1 className="mt-1 text-3xl font-bold text-stone-950">{book.title}</h1>
          <p className="mt-2 text-stone-600">
            当前已有 {cards.length} 张知识卡片，已处理到第 {book.generation_cursor || 0} 个小节。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
            onClick={() => generate({ force: false })}
            disabled={busy}
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
            继续生成
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
            onClick={startBookGeneration}
            disabled={actionBusy || hasUnfinishedJob}
            title="仅从当前书的保存进度开始，依次生成全部剩余小节"
          >
            <Sparkles size={16} />
            生成本书全部小节
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
            onClick={() => generate({ force: true })}
            disabled={busy}
            title="清空旧卡片并从头生成体系卡"
          >
            <RefreshCw size={16} />
            从头生成
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
            onClick={downloadBookDatabase}
            disabled={actionBusy}
            title="导出仅包含当前书籍的独立 SQLite 数据库"
          >
            <Database size={16} />
            导出本书数据库
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => onRead(bookId)}
            disabled={!cards.length}
            title="跳转到上次退出时阅读的卡片"
          >
            <Play size={16} />
            开始阅读
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm leading-6 text-blue-900">
        生成逻辑：按小节交给 DeepSeek。每个小节优先生成一张导览卡，说明这一节为什么需要、能做什么、会涉及哪些下级概念；然后再生成概念卡。阅读时系统会在后台继续生成下一节。
      </div>

      {jobAppliesToBook && (
        <div className="mb-4">
          <GenerationJobStatus
            job={generation.job}
            bookTitle={generation.job.current_book_id === bookId ? book.title : "全应用生成队列"}
            onPause={() => pauseOrResume(generation.pause)}
            onResume={() => pauseOrResume(generation.resume)}
            actionBusy={actionBusy}
          />
        </div>
      )}

      {message && <p className="mb-4 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">{message}</p>}
      {generation.error && <p className="mb-4 text-sm text-red-700">{generation.error}</p>}
      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 shrink-0" size={16} />
          <span>{error}</span>
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {/* 概览页只展示可扫描摘要，完整寓言、公式和关系在沉浸阅读页展开。 */}
        {cards.map((card) => (
          <button
            key={card.id}
            className="rounded-md border border-stone-200 bg-white p-4 text-left shadow-sm transition hover:border-stone-400 hover:bg-stone-50"
            onClick={() => onRead(bookId, card.id)}
            title={`从“${card.title}”开始阅读`}
          >
            <p className="text-xs text-stone-500">
              {card.card_type === "section_overview" ? "导览" : "概念"} · {card.chapter}
            </p>
            <h2 className="mt-1 font-semibold text-stone-950">{card.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-600">{card.one_sentence}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

function parseBookIds(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}
