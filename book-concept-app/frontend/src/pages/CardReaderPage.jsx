import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { api } from "../api/client";
import ConceptCard from "../components/ConceptCard";
import ChatPanel from "../components/ChatPanel";
import OutlineTree from "../components/OutlineTree";

export default function CardReaderPage({ bookId }) {
  const [cards, setCards] = useState([]);
  const [outline, setOutline] = useState([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const [prefetching, setPrefetching] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const containerRef = useRef(null);
  const cardRefs = useRef({});
  const restoredRef = useRef(false);
  const prefetchingRef = useRef(false);
  const requestedCursorRef = useRef(null);

  const progressKey = useMemo(() => `reader-progress-${bookId}`, [bookId]);
  const autoPrefetchKey = useMemo(() => `reader-auto-prefetch-${bookId}`, [bookId]);
  const [autoPrefetch, setAutoPrefetch] = useState(() => localStorage.getItem(autoPrefetchKey) !== "false");

  const load = async () => {
    const [cardData, outlineData] = await Promise.all([api.listCards(bookId), api.getOutline(bookId)]);
    setCards(cardData);
    setOutline(outlineData);
    return { cardData, outlineData };
  };

  useEffect(() => {
    restoredRef.current = false;
    requestedCursorRef.current = null;
    setGenerationStatus("");
    setAutoPrefetch(localStorage.getItem(autoPrefetchKey) !== "false");
    load().catch((err) => setError(err.message));
  }, [bookId, autoPrefetchKey]);

  useEffect(() => {
    if (restoredRef.current || !cards.length) return;
    restoredRef.current = true;
    const saved = readProgress(progressKey);
    const savedIndex = cards.findIndex((card) => card.id === saved.cardId);
    const nextActive = savedIndex >= 0 ? savedIndex : Math.min(saved.index || 0, cards.length - 1);
    setActive(nextActive);
    requestAnimationFrame(() => {
      cardRefs.current[cards[nextActive]?.id]?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  }, [cards, progressKey]);

  useEffect(() => {
    const activeCard = cards[active];
    if (!activeCard) return;
    localStorage.setItem(
      progressKey,
      JSON.stringify({
        cardId: activeCard.id,
        index: active,
        sectionIndex: activeCard.section_index,
        savedAt: Date.now(),
      }),
    );

    if (autoPrefetch) {
      maybeGenerateNextSection(activeCard);
    }
  }, [active, cards, outline, progressKey, autoPrefetch]);

  const updateFavorite = (cardId, isFavorite) => {
    setCards((items) => items.map((item) => (item.id === cardId ? { ...item, is_favorite: isFavorite } : item)));
  };

  const jumpToSection = (sectionIndex) => {
    const target = cards.find((card) => card.section_index === sectionIndex);
    if (!target) return;
    cardRefs.current[target.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const toggleAutoPrefetch = (checked) => {
    setAutoPrefetch(checked);
    localStorage.setItem(autoPrefetchKey, checked ? "true" : "false");
  };

  const maybeGenerateNextSection = async (activeCard = cards[active]) => {
    if (!activeCard || prefetchingRef.current) return;
    const ordered = outline.slice().sort((a, b) => a.index - b.index);
    const currentOutlineIndex = ordered.findIndex((item) => item.index === activeCard.section_index);
    if (currentOutlineIndex < 0) return;
    const next = ordered[currentOutlineIndex + 1];
    if (!next || next.generated || requestedCursorRef.current === next.index) return;

    requestedCursorRef.current = next.index;
    prefetchingRef.current = true;
    setPrefetching(true);
    setGenerationStatus(`正在生成第 ${currentOutlineIndex + 2} / ${ordered.length} 节：${next.title}`);
    try {
      const result = await api.generateCards(bookId, { force: false });
      setGenerationStatus(`已新增 ${result.generated} 张卡片，进度 ${result.cursor} / ${result.total_sections}`);
      await load();
    } catch (err) {
      requestedCursorRef.current = null;
      setGenerationStatus(`生成失败：${err.message}`);
    } finally {
      prefetchingRef.current = false;
      setPrefetching(false);
    }
  };

  if (error) {
    return <div className="mx-auto max-w-4xl px-4 py-12 text-red-700">{error}</div>;
  }

  const activeCard = cards[active];

  return (
    <section className="grid h-[calc(100vh-56px)] lg:grid-cols-[280px_minmax(0,1fr)_420px]">
      <aside className="hidden h-[calc(100vh-56px)] overflow-y-auto border-r border-stone-200 bg-white lg:block">
        <div className="sticky top-0 border-b border-stone-100 bg-white p-4">
          <h2 className="font-semibold text-stone-950">文章大纲</h2>
          <p className="mt-1 text-xs text-stone-500">点击小节跳到对应卡片</p>
          <div className="mt-3 flex flex-col gap-2">
            <button
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-stone-300 px-2 text-xs font-medium hover:bg-stone-50 disabled:opacity-50"
              onClick={() => maybeGenerateNextSection()}
              disabled={prefetching || !activeCard}
            >
              {prefetching ? <Loader2 className="animate-spin" size={13} /> : <Sparkles size={13} />}
              生成下一节
            </button>
            <label className="flex items-center gap-2 text-xs text-stone-600">
              <input type="checkbox" checked={autoPrefetch} onChange={(event) => toggleAutoPrefetch(event.target.checked)} />
              阅读时立即自动生成下一节
            </label>
          </div>
          {(prefetching || generationStatus) && (
            <p className={`mt-2 inline-flex items-start gap-1 rounded-md px-2 py-1 text-xs ${prefetching ? "bg-blue-50 text-blue-700" : "bg-stone-100 text-stone-600"}`}>
              {prefetching && <Loader2 className="mt-0.5 animate-spin" size={13} />}
              {generationStatus}
            </p>
          )}
        </div>
        <OutlineTree outline={outline} activeSectionIndex={activeCard?.section_index} onJump={jumpToSection} />
      </aside>

      <div
        ref={containerRef}
        className="reader-scroll h-[calc(100vh-56px)] overflow-y-auto bg-[#e8ece6]"
        onScroll={(event) => {
          const index = Math.round(event.currentTarget.scrollTop / event.currentTarget.clientHeight);
          setActive(Math.min(Math.max(index, 0), Math.max(cards.length - 1, 0)));
        }}
      >
        {cards.map((card, index) => (
          <div
            key={card.id}
            ref={(node) => {
              if (node) cardRefs.current[card.id] = node;
            }}
            className="reader-card flex h-[calc(100vh-56px)] items-center justify-center px-4 py-6"
          >
            <ConceptCard card={card} index={index} total={cards.length} onFavorite={updateFavorite} />
          </div>
        ))}
        {!cards.length && <div className="p-8 text-stone-600">还没有知识卡片，请先生成。</div>}
      </div>

      <ChatPanel card={activeCard} />
    </section>
  );
}

function readProgress(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}
