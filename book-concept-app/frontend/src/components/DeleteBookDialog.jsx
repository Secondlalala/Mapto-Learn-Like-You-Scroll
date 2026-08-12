import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";


export default function DeleteBookDialog({ open, book, cardCount, busy, error, onClose, onConfirm }) {
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    if (open) setConfirmation("");
  }, [open, book?.id]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, busy, onClose]);

  if (!open || !book) return null;

  const matches = confirmation === book.title;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 px-4" role="presentation">
      <section
        className="w-full max-w-md rounded-md border border-stone-300 bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-book-title"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
              <AlertTriangle size={19} />
            </span>
            <div>
              <h2 id="delete-book-title" className="text-lg font-semibold text-stone-950">删除本书数据库</h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">
                将删除《{book.title}》、{cardCount} 张卡片，以及它们的收藏和追问记录。其他书籍和应用数据库文件不会被删除。
              </p>
            </div>
          </div>
          <button
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100"
            onClick={onClose}
            disabled={busy}
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <label className="mt-5 block text-sm font-medium text-stone-800" htmlFor="delete-book-confirmation">
          输入完整书名确认：{book.title}
        </label>
        <input
          id="delete-book-confirmation"
          className="mt-2 h-10 w-full rounded-md border border-stone-300 px-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoFocus
          disabled={busy}
          autoComplete="off"
        />

        {error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="h-10 rounded-md border border-stone-300 bg-white px-4 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onConfirm(confirmation)}
            disabled={busy || !matches}
          >
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}
