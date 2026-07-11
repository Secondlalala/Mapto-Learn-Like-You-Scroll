import katex from "katex";
import "katex/dist/katex.min.css";

export default function RichText({ text = "" }) {
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
  return (
    <div className="overflow-x-auto rounded-md bg-stone-50 px-3 py-3 text-center">
      <span dangerouslySetInnerHTML={{ __html: renderKatex(latex, true) }} />
    </div>
  );
}

function splitBlocks(text) {
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
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

