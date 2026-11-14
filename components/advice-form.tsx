"use client";

import { useActionState, useEffect, useState } from "react";
import { publishAdviceAction, type AdviceFormState } from "@/app/courses/[courseId]/advice/actions";
import {
  ADVICE_BODY_MAX_LENGTH, ADVICE_LINK_TITLE_MAX_LENGTH, ADVICE_SCOPE_KINDS, ADVICE_TITLE_MAX_LENGTH, adviceMessage, SCOPE_LABELS, type AdviceScopeName,
} from "@/lib/advice-rules";

export type AdviceFormOptions = {
  exams: { id: string; title: string; year: number | null }[];
  terms: { id: string; name: string }[];
  topics: string[];
  questions: { id: string; rank: number; label: string }[];
};

function Target({ kind, options, value }: { kind: AdviceScopeName; options: AdviceFormOptions; value: string }) {
  if (kind === "COURSE") return null;
  const items = kind === "EXAM" ? options.exams.map(exam => ({ value: exam.id, label: exam.year ? `${exam.title} (${exam.year})` : exam.title }))
    : kind === "SESSION" ? options.terms.map(term => ({ value: term.id, label: term.name }))
    : kind === "TOPIC" ? options.topics.map(topic => ({ value: topic, label: topic }))
    : options.questions.map(question => ({ value: question.id, label: `#${question.rank} ${question.label}` }));
  if (!items.length) return <p className="muted">This course has nothing to choose here yet. Pick another scope.</p>;
  return <select key={kind} name="scopeValue" defaultValue={value} required aria-label={SCOPE_LABELS[kind]}>
    <option value="">Choose…</option>
    {items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
  </select>;
}

// The typed values come back in the state after a refusal (the same pattern as the profile form), so nothing the student
// wrote is ever put in the URL.
export function AdviceForm({ courseId, options }: { courseId: string; options: AdviceFormOptions }) {
  const [state, formAction, pending] = useActionState(publishAdviceAction, { status: "idle" } as AdviceFormState);
  const values = state.values;
  const [kind, setKind] = useState<AdviceScopeName>((values?.scopeKind as AdviceScopeName) ?? "COURSE");
  useEffect(() => { if (state.status === "published") setKind("COURSE"); }, [state]);
  return <form action={formAction}>
    <input type="hidden" name="courseId" value={courseId} />
    {state.status === "published" && <p role="status">Your advice was published.</p>}
    {state.status === "error" && <p role="alert">{adviceMessage(state.error ?? "unexpected")}</p>}
    <label>What is it about?
      <select name="scopeKind" value={kind} onChange={event => setKind(event.target.value as AdviceScopeName)}>
        {ADVICE_SCOPE_KINDS.map(item => <option key={item} value={item}>{SCOPE_LABELS[item]}</option>)}
      </select>
    </label>
    <Target kind={kind} options={options} value={values?.scopeKind === kind ? values.scopeValue : ""} />
    <label>Title
      <input name="title" defaultValue={values?.title ?? ""} maxLength={ADVICE_TITLE_MAX_LENGTH} required />
    </label>
    <label>Your advice
      <textarea name="body" defaultValue={values?.body ?? ""} maxLength={ADVICE_BODY_MAX_LENGTH} rows={6} required />
    </label>
    <label>Helpful link (optional, must start with https://)
      <input type="url" name="resourceUrl" defaultValue={values?.resourceUrl ?? ""} placeholder="https://" />
    </label>
    <label>Link name (optional)
      <input name="resourceTitle" defaultValue={values?.resourceTitle ?? ""} maxLength={ADVICE_LINK_TITLE_MAX_LENGTH} />
    </label>
    <label><input type="checkbox" name="isAnonymous" defaultChecked={values?.isAnonymous ?? false} /> Publish anonymously (your name is hidden from students)</label>
    <button className="button" type="submit" disabled={pending}>{pending ? "Publishing…" : "Publish advice"}</button>
  </form>;
}
