import type { Outcome } from "./context";
import type { RowCounts } from "./data";

export type TrialRecord = Outcome & { feature: string; trial: number; type: string; valid: boolean };
export type RunInfo = {
  date: string; startedAt: string; commit: string; seed: number; runsPerFeature: number; durationSeconds: number;
  skipped: { feature: string; reason: string }[]; aborted: boolean;
  database: { before: RowCounts; after: RowCounts; changes: string[]; uploadFolderChanges: string[] };
};

type Tally = { trials: number; successes: number; failures: number; rate: number; avgMs: number };

function tally(records: TrialRecord[]): Tally {
  const successes = records.filter(record => record.ok).length;
  const times = records.map(record => record.ms).filter(Number.isFinite);
  return {
    trials: records.length, successes, failures: records.length - successes,
    rate: records.length ? (successes / records.length) * 100 : 0,
    avgMs: times.length ? times.reduce((sum, ms) => sum + ms, 0) / times.length : 0,
  };
}

const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const pct = (value: number) => `${value.toFixed(1)}%`;
const ms = (value: number) => `${value.toFixed(1)} ms`;
// Keeps table cells on one line.
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function buildReport(info: RunInfo, features: string[], records: TrialRecord[]) {
  const byFeature = features.map(feature => ({ feature, records: records.filter(record => record.feature === feature) }));
  const overall = tally(records);
  const failures = records.filter(record => !record.ok);
  const restored = !info.database.changes.length && !info.database.uploadFolderChanges.length;

  const lines = [
    `# Reliability Report — ${info.date}`,
    "",
    `- **Date:** ${info.startedAt}`,
    `- **Commit:** \`${info.commit}\``,
    `- **Seed:** \`${info.seed}\` (repeat with \`RELIABILITY_SEED=${info.seed} RELIABILITY_RUNS=${info.runsPerFeature} npm run reliability\`)`,
    `- **Trials per feature:** ${info.runsPerFeature}`,
    `- **Overall success rate:** **${pct(overall.rate)}** (${overall.successes} of ${overall.trials} trials; ${overall.failures} failure${overall.failures === 1 ? "" : "s"})`,
    `- **Duration:** ${Math.round(info.durationSeconds)} s`,
    `- **Database restored:** ${restored ? "yes — every table's row count and the upload folders match the start of the run" : "**NO** — see below"}`,
    ...(info.aborted ? ["- **Run aborted before all trials finished.**"] : []),
    "",
    "A trial is a success when the system does the right thing: it accepts valid input, or it correctly refuses invalid input. It is a failure when the system errors, refuses valid input, or accepts invalid input. Average response time is the main request of each trial, measured by the client.",
    "",
    "## Summary",
    "",
    row(["Feature", "Trials", "Successes", "Failures", "Success rate", "Avg response"]),
    row(["---", "---:", "---:", "---:", "---:", "---:"]),
    ...byFeature.map(({ feature, records: items }) => {
      const t = tally(items);
      return row([feature, t.trials, t.successes, t.failures, pct(t.rate), ms(t.avgMs)]);
    }),
    row(["**Overall**", overall.trials, overall.successes, overall.failures, `**${pct(overall.rate)}**`, ms(overall.avgMs)]),
    ...info.skipped.map(item => `\n_${item.feature} was skipped: ${item.reason}_`),
    "",
    "## By feature and trial type",
  ];

  for (const { feature, records: items } of byFeature) {
    const t = tally(items);
    lines.push("", `### ${feature}`, "", `${t.trials} trials, ${t.successes} successes, ${t.failures} failures, ${pct(t.rate)}, average ${ms(t.avgMs)}.`, "",
      row(["Trial type", "Input", "Trials", "Successes", "Failures", "Success rate", "Avg response"]),
      row(["---", "---", "---:", "---:", "---:", "---:", "---:"]));
    for (const type of [...new Set(items.map(item => item.type))]) {
      const ofType = items.filter(item => item.type === type);
      const typeTally = tally(ofType);
      lines.push(row([type, ofType[0].valid ? "valid" : "invalid", typeTally.trials, typeTally.successes, typeTally.failures, pct(typeTally.rate), ms(typeTally.avgMs)]));
    }
  }

  lines.push("", "## Failures", "");
  if (!failures.length) lines.push("No failures.");
  else {
    lines.push(row(["Feature", "Trial", "Type", "Input", "Expected", "Actual"]), row(["---", "---:", "---", "---", "---", "---"]));
    for (const failure of failures) lines.push(row([failure.feature, failure.trial, failure.type, cell(failure.input), cell(failure.expected), cell(failure.actual)]));
  }

  lines.push("", "## Database check", "", row(["Table", "Before", "After"]), row(["---", "---:", "---:"]),
    ...(Object.keys(info.database.before) as (keyof RowCounts)[]).map(key => row([key, info.database.before[key], info.database.after[key]])), "");
  if (info.database.uploadFolderChanges.length) lines.push(`Upload folder changes: ${info.database.uploadFolderChanges.join(", ")}`, "");

  const json = {
    ...info,
    overall,
    features: byFeature.map(({ feature, records: items }) => ({
      feature, ...tally(items),
      types: [...new Set(items.map(item => item.type))].map(type => ({ type, valid: items.find(item => item.type === type)!.valid, ...tally(items.filter(item => item.type === type)) })),
    })),
    failures,
    trials: records,
  };
  return { markdown: lines.join("\n"), json: JSON.stringify(json, null, 2), overall, restored };
}
