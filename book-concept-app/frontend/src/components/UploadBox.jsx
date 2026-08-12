import { Upload } from "lucide-react";
import { useRef } from "react";

export default function UploadBox({ busy, onUpload }) {
  // 隐藏原生文件输入框，由统一样式按钮触发；拖拽与选择最终调用同一上传函数。
  const inputRef = useRef(null);

  return (
    <div
      className="rounded-md border-2 border-dashed border-stone-300 bg-white p-6 shadow-sm"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        // MVP 每次只处理第一个文件，批量导入留给后续版本。
        const file = event.dataTransfer.files?.[0];
        if (file) onUpload(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
        }}
      />
      <button
        className="flex w-full flex-col items-center gap-3 rounded-md bg-stone-50 px-4 py-10 text-center hover:bg-stone-100 disabled:opacity-60"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        <Upload size={28} />
        <span className="font-semibold">{busy ? "上传中..." : "选择或拖拽 Markdown/TXT 文件"}</span>
        <span className="text-sm text-stone-500">上传后会保存原文并按章节切分</span>
      </button>
    </div>
  );
}
