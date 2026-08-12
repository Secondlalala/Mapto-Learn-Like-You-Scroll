import katex from "katex";
import "katex/dist/katex.min.css";

export default function RichText({ text = "" }) {
  // 先解析为段落、列表和块公式，再分别渲染，避免直接输出模型返回的 HTML。
  const blocks = splitBlocks(text);
  return (
    <div className="space-y-3 text-sm leading-7 text-stone-800">
      {blocks.map((block, index) => {
        if (block.type === "math") {
          return <MathBlock key={index} latex={block.content} />;
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`}>{renderInlineMath(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{renderInlineMath(block.content)}</p>;
      })}
    </div>
  );
}

function MathBlock({ latex }) {
  // 块公式允许水平滚动，较长的推导不会撑破卡片宽度或覆盖相邻内容。
  return (
    <div className="overflow-x-auto rounded-md bg-stone-50 px-3 py-3 text-center">
      <span dangerouslySetInnerHTML={{ __html: renderKatex(latex, true) }} />
    </div>
  );
}

function splitBlocks(text) {
  // DeepSeek 可能返回 $...$、$$...$$、\(...\) 或 \[...\] 四种公式边界。
  // 先统一成美元符号格式，再区分块级公式、列表和普通段落，避免公式被当作纯文本换行。
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");
  const parts = normalized.split(/(\$\$[\s\S]*?\$\$)/g).filter(Boolean);
  const blocks = [];
  for (const part of parts) {
    if (part.startsWith("$$") && part.endsWith("$$")) {
      blocks.push({ type: "math", content: part.slice(2, -2).trim() });
      continue;
    }
    const paragraphs = part.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
    for (const paragraph of paragraphs) {
      const lines = paragraph.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length > 1 && lines.every((line) => /^[-*]\s+/.test(line))) {
        blocks.push({ type: "list", items: lines.map((line) => line.replace(/^[-*]\s+/, "")) });
      } else {
        blocks.push({ type: "paragraph", content: paragraph });
      }
    }
  }
  return blocks;
}

function renderInlineMath(text) {
  // 普通文字保持 React 文本节点，只有成对的单美元符号片段进入 KaTeX。
  const parts = String(text).split(/(\$[^$\n]+\$)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("$") && part.endsWith("$")) {
      return (
        <span
          key={index}
          className="mx-0.5"
          dangerouslySetInnerHTML={{ __html: renderKatex(part.slice(1, -1), false) }}
        />
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function renderKatex(latex, displayMode) {
  try {
    // 禁止 KaTeX trust 模式，模型返回的公式不能注入链接、HTML 或其他受信任命令。
    // throwOnError=false 让局部公式错误不会中断整张卡片；真正的异常再回退为转义后的原文。
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    return escapeHtml(latex);
  }
}

function escapeHtml(value) {
  // KaTeX 极端异常时回显经过转义的原公式，既保留可读信息又避免 HTML 注入。
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
