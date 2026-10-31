"use client";

import { useEffect } from "react";

// Scrolls the Upcomer Exam to one question (US-21): the one the student just marked or undid, or, on opening the exam,
// the first question not yet done. Not when the address has a #question-N of its own (a link to one question). Without
// JavaScript, the "Continue" link and the #question-N of the redirect do the same.
export function ResumeScroll({ targetId }: { targetId: string }) {
  useEffect(() => {
    if (window.location.hash) return;
    document.getElementById(targetId)?.scrollIntoView({ block: "start" });
  }, [targetId]);
  return null;
}
