import { motion } from "framer-motion";
import { Check, Clipboard, Heart, Layers, MessageSquare, Quote, Star } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import VoiceButton from "./VoiceButton";
import RichText from "./RichText";

export default function ConceptCard({ card, index, total, onFavorite }) {
  const [copied, setCopied] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [deep, setDeep] = useState(false);

  const text = `${card.title}\n${card.one_sentence}\n\n${card.simple_explanation}\n\n${card.fable}\n\n${card.formula}`;
  const isOverview = card.card_type === "section_overview";

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const favorite = async () => {
    const data = await api.toggleFavorite(card.id);
    onFavorite(card.id, data.is_favorite);
  };

  return (
    <motion.article
      initial={{ opacity: 0.6, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ amount: 0.7 }}
      className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-md border border-stone-200 bg-white shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3">
        <span className="text-sm text-stone-500">
          {index + 1} / {total} · {isOverview ? "小节导览" : "概念"} · {card.chapter}
        </span>
        <div className="flex items-center gap-2">
          <VoiceButton card={card} text={card.simple_explanation} />
          <IconButton onClick={copy} title="复制">{copied ? <Check size={18} /> : <Clipboard size={18} />}</IconButton>
          <IconButton onClick={favorite} title="收藏">
            <Heart size={18} className={card.is_favorite ? "fill-red-500 text-red-500" : ""} />
          </IconButton>
        </div>
      </div>

      <div className="overflow-y-auto p-5">
        <h1 className="text-2xl font-bold text-stone-950">{card.title}</h1>
        <p className={`mt-3 rounded-md p-3 leading-7 ${isOverview ? "bg-amber-50 text-amber-950" : "bg-[#ecf3ff] text-stone-800"}`}>
          {card.one_sentence}
        </p>

        <Section title={isOverview ? "体系导览" : "通俗解释"} icon={isOverview ? <Layers size={16} /> : <Star size={16} />}>
          <RichText text={card.simple_explanation} />
        </Section>

        <Section
          title="寓言故事"
          icon={<Quote size={16} />}
          action={<VoiceButton text={card.fable} label="读寓言" compact={false} includeContext={false} />}
        >
          <RichText text={card.fable} />
        </Section>

        <Section title="核心公式" icon={<MessageSquare size={16} />}>
          <FormulaText formula={card.formula} />
          {card.formula_explanation && <div className="mt-2"><RichText text={card.formula_explanation} /></div>}
        </Section>

        <button className="mt-4 text-sm font-semibold text-stone-900 underline" onClick={() => setDeep(!deep)}>
          {deep ? "收起知识关系" : "展开知识关系"}
        </button>
        {deep && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <PillList title="前置知识" items={card.prerequisites} />
            <PillList title="关联概念" items={card.related_concepts} />
          </div>
        )}

        <button className="mt-4 text-sm font-semibold text-stone-900 underline" onClick={() => setShowSource(!showSource)}>
          {showSource ? "隐藏原文片段" : "查看原文片段"}
        </button>
        {showSource && <p className="mt-3 max-h-40 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-sm leading-6 text-stone-700">{card.source_text}</p>}
      </div>
    </motion.article>
  );
}

function FormulaText({ formula }) {
  const normalized = normalizeFormula(formula);
  if (!normalized) return <RichText text="无明确公式" />;
  return <RichText text={normalized} />;
}

function normalizeFormula(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\$\$[\s\S]*\$\$$/.test(raw)) return raw;
  if (/^\\\[[\s\S]*\\\]$/.test(raw)) return raw.replace(/^\\\[/, "$$").replace(/\\\]$/, "$$");
  if (/^\$[^$][\s\S]*\$$/.test(raw)) return raw;
  if (/^\\\([\s\S]*\\\)$/.test(raw)) return raw.replace(/^\\\(/, "$").replace(/\\\)$/, "$");
  return `$$${raw}$$`;
}

function IconButton({ children, onClick, title }) {
  return (
    <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-200 hover:bg-stone-50" onClick={onClick} title={title}>
      {children}
    </button>
  );
}

function Section({ title, icon, action, children }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-500">{icon}{title}</h2>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

function PillList({ title, items }) {
  return (
    <div className="rounded-md border border-stone-200 p-3">
      <h3 className="mb-2 text-sm font-semibold text-stone-500">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => <span key={item} className="rounded-md bg-stone-100 px-2 py-1 text-sm">{item}</span>)}
      </div>
    </div>
  );
}
