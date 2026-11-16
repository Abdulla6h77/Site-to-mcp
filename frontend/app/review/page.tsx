"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

function extractErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "message" in data) {
    const value = (data as { message: unknown }).message;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return fallback;
}

type MedicineSummary = {
  generic_name?: string;
  brand_names?: string[];
  uses?: string[];
  dosage?: string;
  side_effects?: string[];
  warnings?: string[];
  interactions?: string[];
};

type WarningAssessment = {
  red_flags?: string[];
  interactions?: string[];
  pregnancy_risk?: string | null;
  age_risk?: string | null;
  severity?: "low" | "medium" | "high" | string;
};

type FdaReference = {
  status: "available" | "partial" | "no_match" | "unavailable";
  source?: {
    title: string;
    source_url: string;
    publication_date?: string | null;
    retrieved_at: string;
  };
  announcement_excerpt?: string;
  warning_excerpts?: string[];
  unavailable_fields?: string[];
  warnings_retrieved_at?: string;
  message?: string;
};

type Report = {
  mcp_reference?: FdaReference;
  session_id?: string;
  medicine_summary?: MedicineSummary;
  warning_assessment?: WarningAssessment;
  sources?: string[];
  label_source_url?: string;
  status?: string;
};

function List({ items }: { items: string[] | undefined }) {
  if (!items || items.length === 0) {
    return <p className="text-sm italic text-zinc-500">None reported.</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-6 text-sm text-zinc-800 dark:text-zinc-200">
      {items.map((item, idx) => (
        <li key={`${idx}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<p className="mx-auto p-10 text-zinc-500">Loading report…</p>}>
      <ReviewReport />
    </Suspense>
  );
}

function ReviewReport() {
  const router = useRouter();
  const reportId = useSearchParams().get("id");
  const [report, setReport] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!reportId) return;
    const id = reportId;
    const controller = new AbortController();
    async function load() {
      setReport(null);
      setLoadError(null);
      try {
        const response = await fetch(`${API_BASE}/reports/${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(extractErrorMessage(data, "Unable to load the report."));
        if (!controller.signal.aborted) setReport(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "Unable to load the report.");
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [reportId]);

  const handleApprove = async () => {
    if (report?.status !== "awaiting_human_review" || !report.session_id || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const response = await fetch(`${API_BASE}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: report.session_id,
        }),
      });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        // Non-JSON body; fall through.
      }
      if (
        !response.ok ||
        (data &&
          typeof data === "object" &&
          (data as { status?: string }).status === "error")
      ) {
        setActionError(
          extractErrorMessage(
            data,
            `Save failed with status ${response.status}.`,
          ),
        );
        return;
      }
      setReport({ ...report, status: "approved" });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Unable to reach the backend.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSearchAgain = () => {
    router.push("/");
  };

  if (!reportId || loadError) {
    return (
      <div className="flex flex-1 w-full items-center justify-center px-4 py-12">
        <main className="w-full max-w-2xl flex flex-col gap-4">
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {loadError ?? "Choose a report from research history or start a search."}
          </div>
          <button
            type="button"
            onClick={handleSearchAgain}
            className="self-start rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            🔁 Search Again
          </button>
        </main>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-1 w-full items-center justify-center px-4 py-12">
        <p className="text-sm text-zinc-500">Loading report…</p>
      </div>
    );
  }

  const summary = report.medicine_summary ?? {};
  const assessment = report.warning_assessment ?? {};
  const sources = (report.sources ?? []).filter((url) => /^https?:\/\//i.test(url));
  const approved = report.status === "approved";
  const reference = report.mcp_reference;
  const brandNames = (summary.brand_names ?? []).join(", ");

  return (
    <div className="flex flex-1 w-full justify-center px-4 py-10">
      <main className="w-full max-w-3xl flex flex-col gap-6">
        <div
          role="alert"
          className="rounded-2xl border border-yellow-300 bg-yellow-50 px-5 py-4 text-sm text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-100"
        >
          <strong>{approved ? "Approved and saved" : "Human review required"}</strong> — verify with a licensed
          pharmacist before acting on this information.
        </div>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Medicine Summary
          </h2>
          <dl className="mt-4 grid gap-5 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Generic name
              </dt>
              <dd className="mt-1 text-base text-zinc-900 dark:text-zinc-50">
                {summary.generic_name || "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Brand names
              </dt>
              <dd className="mt-1 text-base text-zinc-900 dark:text-zinc-50">
                {brandNames || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Uses
              </dt>
              <dd className="mt-1">
                <List items={summary.uses} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Dosage
              </dt>
              <dd className="mt-1 text-base text-zinc-900 dark:text-zinc-50">
                {summary.dosage || "Not reported."}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Side effects
              </dt>
              <dd className="mt-1">
                <List items={summary.side_effects} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Warnings
              </dt>
              <dd className="mt-1">
                <List items={summary.warnings} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Interactions
              </dt>
              <dd className="mt-1">
                <List items={summary.interactions} />
              </dd>
            </div>
          </dl>
        </section>

        {reference && (
          <section className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800">
            <h2 className="text-xl font-semibold">Published FDA advisory · MCP</h2>
            <p className="mt-2 text-sm text-zinc-500">
              U.S. Food and Drug Administration reference material. General safety considerations appear below.
            </p>
            {reference.message && <p className="mt-2 text-sm">{reference.message}</p>}
            {reference.source?.source_url.startsWith("https://www.fda.gov/drugs/") && (
              <div className="mt-3 space-y-2 text-sm">
                <a className="font-medium underline" href={reference.source.source_url} target="_blank" rel="noreferrer">
                  {reference.source.title}
                </a>
                <p>Published {reference.source.publication_date ?? "date unavailable"} · Retrieved {new Date(reference.source.retrieved_at).toLocaleString()}</p>
                {reference.announcement_excerpt && <blockquote>{reference.announcement_excerpt}</blockquote>}
                {!!reference.warning_excerpts?.length && (
                  <div>
                    <h3 className="font-medium">FDA warning excerpts</h3>
                    <List items={reference.warning_excerpts} />
                    {reference.warnings_retrieved_at && (
                      <p className="mt-1 text-zinc-500">Warnings retrieved {new Date(reference.warnings_retrieved_at).toLocaleString()}</p>
                    )}
                  </div>
                )}
                {!!reference.unavailable_fields?.length && (
                  <p className="text-zinc-500">Outside this source&apos;s scope: {reference.unavailable_fields.join(", ")}.</p>
                )}
              </div>
            )}
          </section>
        )}

        <section
          className="rounded-2xl border border-zinc-200 p-6 shadow-sm dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">General safety considerations</h2>
            <span className="text-sm text-zinc-500">Individual risk was not assessed</span>
          </div>
          <dl className="mt-4 grid gap-5 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide opacity-80">
                Red flags
              </dt>
              <dd className="mt-1">
                <List items={assessment.red_flags} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide opacity-80">
                Interactions
              </dt>
              <dd className="mt-1">
                {assessment.interactions?.length ? (
                  <List items={assessment.interactions} />
                ) : (
                  <p className="text-sm text-zinc-500">Patient-specific interactions were not assessed.</p>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide opacity-80">
                Pregnancy risk
              </dt>
              <dd className="mt-1 text-base">
                {assessment.pregnancy_risk || "Not reported."}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide opacity-80">
                Age risk
              </dt>
              <dd className="mt-1 text-base">
                {assessment.age_risk || "Not reported."}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="text-lg font-semibold">Sources</h2>
          {sources.length === 0 ? (
            <p className="mt-3 text-sm italic text-zinc-500">
              No sources were captured.
            </p>
          ) : (
            <ul className="mt-3 list-disc space-y-1 pl-6 text-sm">
              {sources.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-blue-700 underline hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                  >
                    {url === report.label_source_url ? "DailyMed drug label" : url === reference?.source?.source_url ? "FDA Drug Safety Communication" : url}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-xs italic text-zinc-500">
          Always consult a licensed pharmacist.
        </p>

        {actionError && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {actionError}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleSearchAgain}
            disabled={saving}
            className="inline-flex h-12 items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 text-base font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            🔁 Search Again
          </button>
          <Link href="/history" className="inline-flex h-12 items-center justify-center px-4 text-sm font-medium underline">
            Research history
          </Link>
          {!approved && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={saving || !report.session_id}
              className="inline-flex h-12 items-center justify-center rounded-lg bg-green-600 px-5 text-base font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : "✅ Approve & Save"}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
