import type { QuestionBankGroup } from "@/lib/question-bank";

export function QuestionList({ groups, emptyMessage }: { groups: QuestionBankGroup[]; emptyMessage: string }) {
  if (!groups.length) return <p className="card muted">{emptyMessage}</p>;
  return <ol className="list question-list">{groups.map(group => <li className="card" key={group.id}>
    <span className="eyebrow">Rank {group.rank}</span>
    <h3>{group.text}</h3>
    <p className="muted">Appeared in {group.paperCount} {group.paperCount === 1 ? "paper" : "papers"}</p>
  </li>)}</ol>;
}
