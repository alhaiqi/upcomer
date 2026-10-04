import type { getCourseExams } from "@/lib/courses";
import { examTypeLabel } from "@/lib/file-metadata-rules";

type Resources = Awaited<ReturnType<typeof getCourseExams>>;
export function ResourceList({ resources, emptyMessage }: { resources: Resources; emptyMessage: string }) {
  if (!resources.length) return <p className="card muted">{emptyMessage}</p>;
  return <div className="list">{resources.map(file => <article className="card" key={file.id}>
    <h3>{file.title}</h3>
    {file.professor && <p className="muted">{file.professor.name}</p>}
    {file.year && <p className="muted">Year: {file.year}</p>}
    {file.term && <p className="muted">Term: {file.term.name}</p>}
    {file.examType && <p className="muted">Type: {examTypeLabel(file.examType)}</p>}
    {file.topic && <p className="muted">Topic: {file.topic}</p>}
    <a className="button" href={`/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noopener noreferrer">Open Original File</a>
  </article>)}</div>;
}
