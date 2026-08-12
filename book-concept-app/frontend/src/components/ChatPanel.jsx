import { Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import RichText from "./RichText";

export default function ChatPanel({ card }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 切换活动卡片时重新加载该卡片的独立历史，避免不同概念的对话混在一起。
    if (!card) return;
    api.listMessages(card.id).then(setMessages).catch(() => setMessages([]));
  }, [card?.id]);

  const ask = async (preset) => {
    const content = (preset || question).trim();
    if (!content || !card) return;
    setBusy(true);
    setQuestion("");
    // 先乐观显示用户问题，减少网络等待造成的“点击无反应”感。
    setMessages((items) => [...items, { role: "user", content }]);
    try {
      const data = await api.ask(card.id, content);
      // 模型回答交给 RichText 解析，使段落、列表和 LaTeX 公式保持可读排版。
      setMessages((items) => [...items, { role: "assistant", content: data.answer }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="hidden h-[calc(100vh-56px)] border-l border-stone-200 bg-white lg:flex lg:flex-col">
      <div className="border-b border-stone-100 p-4">
        <h2 className="font-semibold text-stone-950">追问当前卡片</h2>
        <p className="mt-1 truncate text-sm text-stone-500">{card?.title || "未选择卡片"}</p>
      </div>
      <div className="space-y-2 border-b border-stone-100 p-3">
        {/* 推荐问题与自由输入共用 ask，保证上下文绑定和保存逻辑完全一致。 */}
        {card?.questions?.map((item) => (
          <button key={item} className="block w-full rounded-md bg-stone-100 px-3 py-2 text-left text-sm leading-5 hover:bg-stone-200" onClick={() => ask(item)}>
            {item}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "text-right" : "text-left"}>
            <div className={`inline-block max-w-[94%] rounded-md px-3 py-2 text-left ${message.role === "user" ? "bg-stone-900 text-white" : "bg-stone-50 text-stone-800"}`}>
              {message.role === "user" ? (
                <p className="text-sm leading-6">{message.content}</p>
              ) : (
                <RichText text={message.content} />
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        className="flex gap-2 border-t border-stone-100 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <textarea
          className="min-h-10 min-w-0 flex-1 resize-none rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
          value={question}
          rows={1}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="继续追问..."
        />
        <button className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-stone-900 text-white disabled:opacity-50" disabled={busy || !question.trim()} title="发送">
          <Send size={17} />
        </button>
      </form>
    </aside>
  );
}
