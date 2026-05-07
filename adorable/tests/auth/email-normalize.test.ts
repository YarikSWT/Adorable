import { describe, expect, it } from "vitest";
import { normaliseEmail } from "@/lib/auth/email-normalize";

describe("normaliseEmail", () => {
  it("strips dots in gmail local part", () => {
    expect(normaliseEmail("v.a.s.y.a@gmail.com")).toBe("vasya@gmail.com");
  });

  it("strips plus-aliases", () => {
    expect(normaliseEmail("vasya+anything@gmail.com")).toBe("vasya@gmail.com");
  });

  it("treats googlemail.com like gmail for dots and plus", () => {
    expect(normaliseEmail("v.a.s.y.a+x@googlemail.com")).toBe(
      "vasya@googlemail.com",
    );
  });

  it("leaves dots in non-gmail local parts intact", () => {
    expect(normaliseEmail("first.last@example.com")).toBe("first.last@example.com");
  });

  it("strips plus-aliases on non-gmail too", () => {
    expect(normaliseEmail("user+tag@example.com")).toBe("user@example.com");
  });

  it("lowercases the whole address", () => {
    expect(normaliseEmail("VaSyA@Example.COM")).toBe("vasya@example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseEmail("  vasya@gmail.com  \n")).toBe("vasya@gmail.com");
  });

  it("returns trimmed lowercase passthrough for non-email strings", () => {
    expect(normaliseEmail("  Not An Email ")).toBe("not an email");
  });

  it("only treats the last @ as the separator", () => {
    expect(normaliseEmail("weird@local@example.com")).toBe(
      "weird@local@example.com",
    );
  });

  it("preserves the original local part when neither plus nor dot rules apply", () => {
    expect(normaliseEmail("u_n-d.e_r@example.org")).toBe(
      "u_n-d.e_r@example.org",
    );
  });
});
