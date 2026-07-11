import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../api/client";

export default function BookPage({ bookId, onRead }) {
  const [book, setBook] = useState(null);
  const [cards, setCards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const [bookData, cardData] = await Promise.all([api.getBook(bookId), api.listCards(bookId)]);
    setBook(bookData);
    setCards(cardData);
  };

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [bookId]);

  const generate = async ({ force = false } = {}) => {
    setBusy(true);
    setError("");
    setMessage(force ? "正在清空旧卡片，并从第一节重新生成..." : "正在按小节生成，单次最多 20 张卡片...");
    try {
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

  if (!book) {
    return <div className="mx-auto max-w-4xl px-4 py-12 text-stone-500">加载中...</div>;
  }

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
            onClick={() => generate({ force: true })}
            disabled={busy}
            title="清空旧卡片并从头生成体系卡"
          >
            <RefreshCw size={16} />
            从头生成
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

      {message && <p className="mb-4 rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">{message}</p>}
      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 shrink-0" size={16} />
          <span>{error}</span>
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((card) => (
          <article key={card.id} className="rounded-md border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-stone-500">
              {card.card_type === "section_overview" ? "导览" : "概念"} · {card.chapter}
            </p>
            <h2 className="mt-1 font-semibold text-stone-950">{card.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-stone-600">{card.one_sentence}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
