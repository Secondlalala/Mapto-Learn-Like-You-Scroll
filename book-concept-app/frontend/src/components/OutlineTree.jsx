import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

export default function OutlineTree({ outline, activeSectionIndex, onJump }) {
  const tree = useMemo(() => buildOutlineTree(outline), [outline]);
  return (
    <nav className="space-y-1 p-3">
      {tree.map((node) => (
        <OutlineNode
          key={node.key}
          node={node}
          activeSectionIndex={activeSectionIndex}
          onJump={onJump}
        />
      ))}
    </nav>
  );
}

function OutlineNode({ node, activeSectionIndex, onJump }) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const isActive = activeSectionIndex === node.index;

  return (
    <div>
      <div className={`flex items-start gap-1 rounded-md ${isActive ? "bg-stone-900 text-white" : "hover:bg-stone-100"}`}>
        <button
          className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded"
          onClick={() => setOpen(!open)}
          disabled={!hasChildren}
          title={hasChildren ? "展开/折叠" : ""}
        >
          {hasChildren ? (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <span className="h-4 w-4" />}
        </button>
        <button className="min-w-0 flex-1 px-1 py-2 text-left text-sm" onClick={() => onJump(node.index)}>
          <span className="block truncate font-medium">{node.title}</span>
          <span className={`mt-1 block text-xs ${isActive ? "text-stone-200" : "text-stone-500"}`}>
            {node.card_count} 张卡片
          </span>
        </button>
      </div>
      {hasChildren && open && (
        <div className="ml-4 border-l border-stone-200 pl-2">
          {node.children.map((child) => (
            <OutlineNode
              key={child.key}
              node={child}
              activeSectionIndex={activeSectionIndex}
              onJump={onJump}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function buildOutlineTree(outline) {
  const roots = [];
  const byNumber = new Map();
  let lastTop = null;

  for (const item of outline) {
    const number = extractNumber(item.title);
    const node = { ...item, key: `${item.index}-${item.title}`, children: [], number };

    if (!number) {
      if (lastTop) {
        lastTop.children.push(node);
      } else {
        roots.push(node);
        lastTop = node;
      }
      continue;
    }

    byNumber.set(number, node);
    const parentNumber = number.includes(".") ? number.split(".").slice(0, -1).join(".") : "";
    const parent = parentNumber ? byNumber.get(parentNumber) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
      lastTop = node;
    }
  }
  return roots;
}

function extractNumber(title) {
  const match = String(title).match(/^\s*(\d+(?:\.\d+)*)\b/);
  return match?.[1] || "";
}

