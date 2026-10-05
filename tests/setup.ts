import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// next/font only works inside Next's compiler; tests get a font with no class names.
vi.mock("next/font/google", () => ({ Plus_Jakarta_Sans: () => ({ className: "", variable: "", style: { fontFamily: "" } }) }));
