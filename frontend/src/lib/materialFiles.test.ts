import { describe, expect, it } from "vitest";
import {
  maxMaterialFileBytes,
  validateMaterialFile,
} from "./materialFiles";

describe("validateMaterialFile", () => {
  it("accepts supported non-empty files", () => {
    expect(
      validateMaterialFile(
        new File(["lesson"], "lesson.md", { type: "text/markdown" }),
      ),
    ).toBeNull();
  });

  it("rejects unsupported, empty, and oversized files before upload", () => {
    expect(validateMaterialFile(new File(["x"], "lesson.exe"))).toBe(
      "unsupported",
    );
    expect(validateMaterialFile(new File([], "empty.txt"))).toBe("empty");
    const oversized = new File(["x"], "large.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(oversized, "size", {
      value: maxMaterialFileBytes + 1,
    });
    expect(validateMaterialFile(oversized)).toBe("too-large");
  });
});
