"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type HistoryRow = {
  id: number | null;
  session_id: string | null;
  medicine_name: string | null;
  date: string;
  status: "awaiting_human_review" | "approved";
};

export default function HistoryPage() {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/history?include_pending=true`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data)) {
        throw new Error("Unable to load research history.");
      }
      setRows(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError("Unable to load research history.");
    });
    return () => controller.abort();
  }, [attempt]);

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <h1 className="text-3xl font-semibold tracking-tight">Research history</h1>
        <Link href="/" className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white">New search</Link>
      </header>
      {error ? (
        <div role="alert" className="mt-6 rounded-xl border border-red-300 p-5 dark:border-red-900">
          <p>{error}</p>
          <button type="button" className="mt-2 text-sm underline" onClick={() => {
            setError("");
            setAttempt((current) => current + 1);
          }}>Try again</button>
        </div>
      ) : rows === null ? (
        <p role="status" className="mt-6 text-zinc-500">Loading research history…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 p-8 text-zinc-500 dark:border-zinc-700">Completed searches will appear here. Open a report to review its sources and approve it.</p>
      ) : (
        <ul className="mt-6 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((row) => {
            const id = row.session_id || `legacy-${row.id}`;
            return (
              <li key={row.id === null ? id : row.id}>
                <Link href={`/review?id=${encodeURIComponent(id)}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  <div>
                    <p className="font-semibold">{row.medicine_name || "Medicine report"}</p>
                    {row.date && <time dateTime={row.date} className="mt-1 block text-sm text-zinc-500">{new Date(row.date).toLocaleString()}</time>}
                  </div>
                  <span className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium dark:border-zinc-700">
                    {row.status === "approved" ? "Approved" : "Awaiting review"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
