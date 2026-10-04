// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResourceList } from "@/components/resource-list";

describe("resource list", () => {
  it("shows the empty state", () => {
    render(<ResourceList resources={[]} emptyMessage="No exams yet" />);
    expect(screen.getByText("No exams yet")).toBeInTheDocument();
  });
  it("links a resource by ID and shows present metadata", () => {
    const resource = { id: "file-a", title: "Final Exam", professor: { name: "Professor A" }, year: 2025, term: { name: "Fall" }, examType: "FINAL", topic: null };
    render(<ResourceList resources={[resource] as React.ComponentProps<typeof ResourceList>["resources"]} emptyMessage="No exams yet" />);
    expect(screen.getByText("Final Exam")).toBeInTheDocument();
    expect(screen.getByText("Professor A")).toBeInTheDocument();
    expect(screen.getByText("Term: Fall")).toBeInTheDocument();
    expect(screen.getByText("Type: Final")).toBeInTheDocument();
    expect(screen.queryByText(/Session/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Original File" })).toHaveAttribute("href", "/files/file-a");
  });
});
