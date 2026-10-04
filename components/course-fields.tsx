type Option = { id: string; name: string };

// The fields shared by the add and edit course forms.
export function CourseFields({ faculties, professors, course }: {
  faculties: Option[]; professors: Option[]; course?: { code: string; name: string; facultyId: string; professorIds: string[] };
}) {
  return <>
    <label className="field"><span>Code</span><input name="code" placeholder="EECE350" defaultValue={course?.code} required /></label>
    <label className="field"><span>Name</span><input name="name" placeholder="Computer Networks" defaultValue={course?.name} required /></label>
    <label className="field"><span>Faculty</span><select name="facultyId" defaultValue={course?.facultyId ?? ""} required>
      <option value="" disabled>Choose a faculty</option>
      {faculties.map(faculty => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
    </select></label>
    <fieldset className="checkbox-list"><legend>Professors <span className="muted">(optional)</span></legend>
      {professors.length ? professors.map(professor => <label key={professor.id}>
        <input type="checkbox" name="professorIds" value={professor.id} defaultChecked={course?.professorIds.includes(professor.id)} />{professor.name}
      </label>) : <p className="muted">No professors yet.</p>}
    </fieldset>
  </>;
}
