import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const names = [
  "eece350-final-2025.pdf", "eece350-midterm-2024.pdf", "eece350-network-models.pdf",
  "eece330-final-2025.pdf", "eece330-trees-notes.pdf", "math201-formulas.pdf",
];

function pdf(title) {
  const escaped = title.replace(/[()\\]/g, "\\$&");
  const stream = `BT /F1 16 Tf 50 750 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return output;
}

await mkdir("public/uploads", { recursive: true });
for (const name of names) await writeFile(path.join("public/uploads", name), pdf(name.replace(".pdf", "")));
