import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, KeyRound, Library } from "lucide-react";
import { api } from "./api/client";
import UploadPage from "./pages/UploadPage";
import BookPage from "./pages/BookPage";
import CardReaderPage from "./pages/CardReaderPage";
import DeepSeekSettings from "./components/DeepSeekSettings";

export default function App() {
  // MVP 不依赖路由库，顶层 route 状态在上传、书籍详情和沉浸阅读三种视图间切换。
  // 书籍数据集中保存在 App，上传完成后刷新即可同步顶部数量和书库列表。
  const [route, setRoute] = useState({ name: "upload" });
  const [books, setBooks] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refreshBooks = async () => {
    // 后端不可达时保留可渲染的空列表，避免整个应用因首页请求失败而白屏。
    try {
      setBooks(await api.listBooks());
    } catch {
      setBooks([]);
    }
  };

  useEffect(() => {
    refreshBooks();
  }, []);

  const returnToParent = () => {
    // 返回按钮按当前页面层级移动，阅读页先回到所属书籍，而不是直接跳回书库。
    if (route.name === "reader") {
      setRoute({ name: "book", bookId: route.bookId });
      return;
    }
    setRoute({ name: "upload" });
  };

  return (
    <main className="min-h-screen">
      <header className="fixed left-0 right-0 top-0 z-20 border-b border-stone-200 bg-[#f7f5ef]/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <button
            className="flex items-center gap-2 text-sm font-semibold text-stone-900"
            onClick={() => setRoute({ name: "upload" })}
          >
            <BookOpen size={18} />
            AI 书籍概念学习
          </button>
          <div className="flex items-center gap-2">
            {route.name !== "upload" && (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm hover:bg-white"
                onClick={returnToParent}
                title={route.name === "reader" ? "返回当前书籍" : "返回书库"}
              >
                <ArrowLeft size={16} />
                返回
              </button>
            )}
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm hover:bg-white"
              onClick={() => setSettingsOpen(true)}
              title="DeepSeek 与语音设置"
            >
              <KeyRound size={16} />
              设置
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm text-white"
              onClick={() => setRoute({ name: "upload" })}
              title="书库"
            >
              <Library size={16} />
              {books.length}
            </button>
          </div>
        </div>
      </header>

      <div className="pt-14">
        {/* 三个页面共享固定顶部栏，但只挂载当前页面，避免隐藏页面继续发起请求。 */}
        {route.name === "upload" && (
          <UploadPage
            books={books}
            onUploaded={async (bookId) => {
              await refreshBooks();
              setRoute({ name: "book", bookId });
            }}
            onOpenBook={(bookId) => setRoute({ name: "book", bookId })}
            onBooksChanged={refreshBooks}
          />
        )}
        {route.name === "book" && (
          <BookPage
            bookId={route.bookId}
            onRead={(bookId, targetCardId) => setRoute({ name: "reader", bookId, targetCardId })}
            onBooksChanged={refreshBooks}
            onDeleted={async (bookId) => {
              localStorage.removeItem(`reader-progress-${bookId}`);
              await refreshBooks();
              setRoute({ name: "upload" });
            }}
          />
        )}
        {route.name === "reader" && <CardReaderPage bookId={route.bookId} targetCardId={route.targetCardId} />}
      </div>

      <DeepSeekSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
