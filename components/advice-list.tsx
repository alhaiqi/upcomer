import type { PublicAdvice } from "@/lib/advice";
import { SCOPE_LABELS } from "@/lib/advice-rules";

// Shows advice exactly as students may see it: PublicAdvice has no author ID, and an anonymous post has no author name.
export function AdviceList({ items, emptyMessage }: { items: PublicAdvice[]; emptyMessage: string }) {
  if (!items.length) return <p className="muted">{emptyMessage}</p>;
  return <>{items.map(advice => <article key={advice.id} className="card">
    <h3>{advice.title}</h3>
    <p className="muted">
      {advice.scope.kind === "COURSE" ? SCOPE_LABELS.COURSE : `${SCOPE_LABELS[advice.scope.kind]}: ${advice.scope.label}`}
      {" · "}{advice.authorLabel}{" · "}<time dateTime={advice.createdAt.toISOString()}>{advice.createdAt.toISOString().slice(0, 10)}</time>
    </p>
    <p style={{ whiteSpace: "pre-wrap" }}>{advice.body}</p>
    {/* Defense in depth: the link was checked when it was saved, and only an https link is ever rendered. */}
    {advice.resourceUrl?.startsWith("https://") && <p><a href={advice.resourceUrl} target="_blank" rel="noopener noreferrer nofollow">{advice.resourceTitle || advice.resourceUrl}</a> <span className="muted">(external link)</span></p>}
  </article>)}</>;
}
