import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";


const RUNNING_STATUSES = new Set(["queued", "running"]);

export default function useGenerationJob({ onProgress } = {}) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const onProgressRef = useRef(onProgress);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  const refresh = useCallback(async () => {
    try {
      const response = await api.getCurrentGenerationJob();
      // 旧版 FastAPI SPA 回退会把未知 API 伪装成 200 {detail: ...}；不能把它渲染为任务状态。
      const nextJob = response && typeof response.id === "number" ? response : null;
      setJob(nextJob);
      setError("");
      if (nextJob) {
        onProgressRef.current?.(nextJob);
      }
      return nextJob;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let timerId;

    const poll = async () => {
      const current = await refresh();
      if (!disposed && current && RUNNING_STATUSES.has(current.status)) {
        timerId = window.setTimeout(poll, 1500);
      }
    };

    poll();
    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [refresh, job?.status]);

  const startAllBooks = useCallback(async () => {
    const nextJob = await api.startAllBooksGeneration();
    setJob(nextJob);
    setError("");
    onProgressRef.current?.(nextJob);
    return nextJob;
  }, []);

  const startBook = useCallback(async (bookId) => {
    const nextJob = await api.startBookGeneration(bookId);
    setJob(nextJob);
    setError("");
    onProgressRef.current?.(nextJob);
    return nextJob;
  }, []);

  const pause = useCallback(async () => {
    if (!job?.id) return null;
    const nextJob = await api.pauseGenerationJob(job.id);
    setJob(nextJob);
    return nextJob;
  }, [job?.id]);

  const resume = useCallback(async () => {
    if (!job?.id) return null;
    const nextJob = await api.resumeGenerationJob(job.id);
    setJob(nextJob);
    onProgressRef.current?.(nextJob);
    return nextJob;
  }, [job?.id]);

  return {
    job,
    error,
    refresh,
    startAllBooks,
    startBook,
    pause,
    resume,
    isRunning: Boolean(job && RUNNING_STATUSES.has(job.status)),
  };
}
