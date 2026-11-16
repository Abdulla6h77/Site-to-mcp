"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export default function MedicineSearch() {
  const router = useRouter();
  const [medicine, setMedicine] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = medicine.trim();
    if (!name || pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medicine_name: name, patient_context: "" }),
      });
      const result = await response.json();
      if (!response.ok || result.status !== "awaiting_human_review" || !result.session_id) {
        throw new Error(typeof result.message === "string" ? result.message : "Research did not reach review.");
      }
      router.push(`/review?id=${encodeURIComponent(result.session_id)}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reach the research service.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-950 dark:bg-zinc-950 dark:text-stone-50">
      <main className="mx-auto w-full max-w-5xl px-5 pb-20 pt-8 sm:px-10">
        <nav className="flex items-center justify-between gap-4 border-b border-stone-200 pb-5 dark:border-zinc-800">
          <span className="font-semibold">Medicine Autopilot</span>
          <Link href="/history" className="text-sm font-medium underline underline-offset-4">Research history</Link>
        </nav>
        <div className="mt-14 grid gap-9 lg:grid-cols-[1fr_22rem] lg:items-start">
          <section>
            <h1 className="max-w-xl text-4xl font-semibold tracking-tight sm:text-6xl">Research a medicine</h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-stone-600 dark:text-stone-300">
              Look up published medicine information and FDA advisories. Review the sources before saving a report.
            </p>
            <form onSubmit={submit} className="mt-8 rounded-2xl border border-stone-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <label htmlFor="medicine" className="text-sm font-semibold">Medicine name</label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input id="medicine" value={medicine} onChange={event => setMedicine(event.target.value)}
                  required maxLength={60} disabled={pending} placeholder="e.g. cetirizine"
                  className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-3 outline-offset-2 dark:border-zinc-700" />
                <button disabled={pending || !medicine.trim()} className="rounded-lg bg-teal-800 px-5 py-3 font-semibold text-white disabled:opacity-50">
                  {pending ? "Researching…" : "Find references"}
                </button>
              </div>
              {pending && <p role="status" className="mt-3 text-sm">Checking published sources and FDA advisories. This can take a few minutes.</p>}
              {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
            </form>
          </section>
          <aside className="rounded-2xl border border-teal-200 bg-teal-50 p-6 dark:border-teal-950 dark:bg-teal-950/40">
            <h2 className="font-semibold">Sources you can inspect</h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
              <li>Published drug labels for general medicine information.</li>
              <li>FDA Drug Safety Communications for specific advisories.</li>
              <li>Source links and missing evidence in your review.</li>
            </ul>
            <p className="mt-4 border-t border-teal-200 pt-4 text-sm leading-relaxed text-stone-700 dark:border-teal-900 dark:text-stone-300">
              <strong>Coverage:</strong> Search by generic or brand name. DailyMed primarily covers U.S. labels, so some local brands may be missing. A search without a matching FDA advisory does not establish safety.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
