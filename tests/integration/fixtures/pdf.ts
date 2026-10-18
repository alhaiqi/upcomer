// Builds small, real PDFs for the pipeline integration tests, so no binary fixtures are committed.
// Text uses the standard Helvetica font, one line per text operation, pages in order.

const escape = (text: string) => text.replace(/[^\x20-\x7E]/g, "?").replace(/[()\\]/g, "\\$&");

function assemble(objects: string[]) {
  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output, "latin1"));
}

// Each page is a list of lines, drawn top to bottom.
export function textPdf(pages: string[][]) {
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, lines] of pages.entries()) {
    const stream = ["BT", "/F1 11 Tf", ...lines.flatMap((line, row) => [`1 0 0 1 72 ${740 - row * 22} Tm`, `(${escape(line)}) Tj`]), "ET"].join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
  }
  return assemble(objects);
}

// A scanned exam: one page that only draws an image, so there is no text to extract.
export function imageOnlyPdf() {
  const size = 16;
  const pixels = Buffer.alloc(size * size, 0x80).toString("latin1");
  const stream = `q ${size * 20} 0 0 ${size * 20} 72 400 cm /Im1 Do Q`;
  return assemble([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
    `<< /Type /XObject /Subtype /Image /Width ${size} /Height ${size} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${size * size} >>\nstream\n${pixels}\nendstream`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]);
}

// Starts like a PDF, so it passes the upload check, but the rest is not a readable PDF.
export const corruptPdf = () => new Uint8Array(Buffer.from("%PDF-1.4\n%garbage that is not a PDF body\n", "latin1"));
