import { Loader2, Pause, Play } from "lucide-react";


const STATUS_LABELS = {
  queued: "等待后台生成",
  running: "正在后台生成",
  paused: "已暂停",
  completed: "生成完成",
  failed: "生成失败",
};

export default function GenerationJobStatus({ job, bookTitle, onPause, onResume, actionBusy = false }) {
  if (!job) return null;

  const total = Math.max(job.total_sections || 0, 0);
  const processed = Math.min(Math.max(job.processed_sections || 0, 0), total || Number.MAX_SAFE_INTEGER);
  const progress = total ? Math.min((processed / total) * 100, 100) : 0;
  const isRunning = job.status === "queued" || job.status === "running";
  const detail = job.error || job.message || "等待任务状态更新。";

  return (
    <section className="border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-950" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {isRunning && <Loader2 className="mr-1 inline animate-spin" size={15} />}
            {STATUS_LABELS[job.status] || job.status}
          </p>
          <p className="mt-1 text-xs leading-5 text-blue-800">
            {bookTitle ? `当前书籍：${bookTitle}。` : ""}
            {detail}
          </p>
        </div>
        {isRunning && onPause && (
          <button
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-blue-300 bg-white text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            onClick={onPause}
            disabled={actionBusy}
            title="暂停后台生成"
            aria-label="暂停后台生成"
          >
            <Pause size={15} />
          </button>
        )}
        {job.status === "paused" && onResume && (
          <button
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center border border-blue-300 bg-white text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            onClick={onResume}
            disabled={actionBusy}
            title="继续后台生成"
            aria-label="继续后台生成"
          >
            <Play size={15} />
          </button>
        )}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-blue-800">
        <div className="generation-progress min-w-0 flex-1" aria-label={`生成进度 ${processed}/${total}`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="shrink-0">{processed}/{total || "-"} 节 · {job.generated_cards || 0} 张</span>
      </div>
    </section>
  );
}
