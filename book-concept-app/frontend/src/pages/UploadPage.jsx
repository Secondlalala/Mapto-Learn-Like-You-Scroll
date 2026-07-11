import { useState } from "react";
import { FileText } from "lucide-react";
import { api } from "../api/client";
import UploadBox from "../components/UploadBox";

export default function UploadPage({ books, onUploaded, onOpenBook }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file) => {
    setBusy(true);
    setError("");
    try {
      const data = await api.uploadBook(file);
      onUploaded(data.book_id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
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
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-normal text-stone-500">已上传书籍</h2>
        <div className="space-y-3">
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

