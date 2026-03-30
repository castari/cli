/**
 * loader.test.ts
 *
 * Tests for the validation and default-filling logic in loader.ts.
 *
 * Strategy: we test the internal validators directly by importing the
 * exported functions and feeding them in-memory objects. No filesystem
 * involvement except for the castari.json resolution tests, which write
 * real files to a temp dir (same pattern as runner.test.ts).
 *
 * Every test is either:
 *   - A "happy path" that confirms valid input passes and defaults are filled
 *   - A "sad path" that confirms invalid input throws LoadError with a
 *     message that contains the right hint (not an exact string match, so
 *     the wording can evolve without breaking tests)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { LoadError, resolveFromCastariJson } from "../../eval/loader.js";

// ---------------------------------------------------------------------------
// We need access to the private validators. The cleanest way without
// exporting them is to test them indirectly through loadEvalSuite — but
// that requires real files. Instead, we re-export them via a thin test
// helper to keep tests fast and pure.
//
// If the maintainer decides to export validateAndFillSuite in future, this
// helper can just be removed.
// ---------------------------------------------------------------------------

// Because the validators are not exported, we test through a minimal
// wrapper that calls JSON.parse on the raw object and runs validation.
// We achieve this by importing loadEvalSuite and stubbing the filesystem.

import { loadEvalSuite } from "../../eval/loader.js";

// ---------------------------------------------------------------------------
// Filesystem helpers for tests that need real files
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
    tmpRoot = resolve(tmpdir(), `castari-loader-test-${Date.now()}-${Math.random().toString(36).substring(2)}`);
    await mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

/** Write castari.eval.json and (optionally) a stub entrypoint + castari.json */
async function writeEvalFile(suite: unknown, opts: {
    withEntrypoint?: boolean; // also write a stub .mjs and castari.json
    entrypointFilename?: string;
} = {}): Promise<string> {
    const evalPath = resolve(tmpRoot, "castari.eval.json");
    await writeFile(evalPath, JSON.stringify(suite), "utf8");

    if (opts.withEntrypoint) {
        const epFile = opts.entrypointFilename ?? "agent.mjs";
        const epPath = resolve(tmpRoot, epFile);
        await writeFile(epPath, `process.stdout.write("ok");`, "utf8");

        // Write suite-level entrypoint into the JSON so loadEvalSuite finds it
        const suiteWithEp = { ...(suite as object), entrypoint: epFile };
        await writeFile(evalPath, JSON.stringify(suiteWithEp), "utf8");
    }

    return evalPath;
}

/** Minimal valid suite object — extend per test */
function validSuite(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: "My Suite",
        cases: [
            {
                name: "basic case",
                input: "hello",
                assert: [{ type: "contains", expected: "world" }],
            },
        ],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Top-level suite validation
// ---------------------------------------------------------------------------

describe("loader — suite structure", () => {
    it("loads a minimal valid suite and fills defaults", async () => {
        await writeEvalFile(validSuite(), { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);

        expect(suite.name).toBe("My Suite");
        expect(suite.timeout).toBe(30_000); // default filled
        expect(suite.cases).toHaveLength(1);
    });

    it("preserves explicit timeout when provided", async () => {
        await writeEvalFile(validSuite({ timeout: 5000 }), { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);

        expect(suite.timeout).toBe(5000);
    });

    it("trims whitespace from suite name", async () => {
        await writeEvalFile(validSuite({ name: "  My Suite  " }), { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);

        expect(suite.name).toBe("My Suite");
    });

    it("throws LoadError when top-level is an array, not an object", async () => {
        await writeFile(resolve(tmpRoot, "castari.eval.json"), "[]", "utf8");

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(LoadError);
    });

    it("throws LoadError when file does not exist", async () => {
        await expect(loadEvalSuite("nonexistent.eval.json", tmpRoot))
            .rejects.toThrow(LoadError);

        await expect(loadEvalSuite("nonexistent.eval.json", tmpRoot))
            .rejects.toThrow(/not found/i);
    });

    it("includes cast eval-init hint in missing-file error", async () => {
        await expect(loadEvalSuite("nonexistent.eval.json", tmpRoot))
            .rejects.toThrow(/eval-init/i);
    });

    it("throws LoadError on malformed JSON", async () => {
        await writeFile(resolve(tmpRoot, "castari.eval.json"), "{ bad json", "utf8");

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(LoadError);

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/not valid JSON/i);
    });

    it("throws when name is missing", async () => {
        const { name: _, ...noName } = validSuite() as { name: string;[k: string]: unknown };

        await writeFile(resolve(tmpRoot, "castari.eval.json"), JSON.stringify(noName), "utf8");

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"name"/);
    });

    it("throws when name is an empty string", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(validSuite({ name: "   " })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"name"/);
    });

    it("throws when cases is not an array", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(validSuite({ cases: "not an array" })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"cases"/);
    });

    it("throws when cases array is empty", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(validSuite({ cases: [] })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/at least one/i);
    });

    it("throws when timeout is not a positive integer", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(validSuite({ timeout: -500 })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/timeout/i);
    });

    it("throws when timeout is a float", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(validSuite({ timeout: 1.5 })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/timeout/i);
    });

    it("throws when entrypoint field is not a string", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(validSuite({ entrypoint: 42 })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/entrypoint/i);
    });
});

// ---------------------------------------------------------------------------
// Case-level validation
// ---------------------------------------------------------------------------

describe("loader — case structure", () => {
    function suiteWithCase(c: unknown): Record<string, unknown> {
        return validSuite({ cases: [c] });
    }

    it("fills no default on case timeout when absent", async () => {
        await writeEvalFile(validSuite(), { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);

        expect(suite.cases[0].timeout).toBeUndefined();
    });

    it("preserves case-level timeout", async () => {
        const s = validSuite({
            cases: [{ name: "t", input: "hi", assert: [{ type: "contains", expected: "x" }], timeout: 2000 }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);

        expect(suite.cases[0].timeout).toBe(2000);
    });

    it("trims whitespace from case name and input", async () => {
        const s = validSuite({
            cases: [{ name: "  trimmed  ", input: "  hi  ", assert: [{ type: "contains", expected: "x" }] }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);

        expect(suite.cases[0].name).toBe("trimmed");
        expect(suite.cases[0].input).toBe("hi");
    });

    it("throws when case is not an object", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(suiteWithCase("a string")),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(LoadError);
    });

    it("throws when case name is missing", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(suiteWithCase({ input: "hi", assert: [{ type: "contains", expected: "x" }] })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"name"/);
    });

    it("throws when case input is missing", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(suiteWithCase({ name: "x", assert: [{ type: "contains", expected: "x" }] })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"input"/);
    });

    it("throws when case input is empty string", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(suiteWithCase({ name: "x", input: "", assert: [{ type: "contains", expected: "x" }] })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"input"/);
    });

    it("throws when assert array is empty", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(suiteWithCase({ name: "x", input: "hi", assert: [] })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/at least one grader/i);
    });

    it("includes a hint in empty-assert error", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(suiteWithCase({ name: "x", input: "hi", assert: [] })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/contains/i); // hint mentions contains grader
    });

    it("throws when tags contains a non-string element", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(suiteWithCase({ name: "x", input: "hi", assert: [{ type: "contains", expected: "x" }], tags: ["ok", 42] })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"tags"/);
    });

    it("throws when case timeout is a float", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.eval.json"),
            JSON.stringify(suiteWithCase({ name: "x", input: "hi", assert: [{ type: "contains", expected: "x" }], timeout: 1.5 })),
            "utf8"
        );

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/timeout/i);
    });
});

// ---------------------------------------------------------------------------
// Grader validation — exact / contains / not-contains
// ---------------------------------------------------------------------------

describe("loader — string graders (exact, contains, not-contains)", () => {
    async function writeWithGrader(grader: unknown): Promise<void> {
        const s = validSuite({ cases: [{ name: "g", input: "hi", assert: [grader] }] });
        await writeFile(resolve(tmpRoot, "castari.eval.json"), JSON.stringify(s), "utf8");
    }

    for (const type of ["exact", "contains", "not-contains"] as const) {
        it(`${type}: passes with valid expected string`, async () => {
            const s = validSuite({
                cases: [{ name: "g", input: "hi", assert: [{ type, expected: "hello" }] }],
            });
            await writeEvalFile(s, { withEntrypoint: true });

            const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);

            expect(suite.cases[0].assert[0]).toMatchObject({ type, expected: "hello" });
        });

        it(`${type}: throws when expected is missing`, async () => {
            await writeWithGrader({ type });

            await expect(loadEvalSuite("castari.eval.json", tmpRoot))
                .rejects.toThrow(/"expected"/);
        });

        it(`${type}: throws when expected is a number`, async () => {
            await writeWithGrader({ type, expected: 42 });

            await expect(loadEvalSuite("castari.eval.json", tmpRoot))
                .rejects.toThrow(/"expected"/);
        });

        it(`${type}: throws when caseSensitive is a string instead of boolean`, async () => {
            await writeWithGrader({ type, expected: "x", caseSensitive: "yes" });

            await expect(loadEvalSuite("castari.eval.json", tmpRoot))
                .rejects.toThrow(/caseSensitive/i);
        });
    }
});

// ---------------------------------------------------------------------------
// Grader validation — regex
// ---------------------------------------------------------------------------

describe("loader — regex grader", () => {
    async function writeWithRegex(grader: unknown): Promise<void> {
        const s = validSuite({ cases: [{ name: "g", input: "hi", assert: [grader] }] });
        await writeFile(resolve(tmpRoot, "castari.eval.json"), JSON.stringify(s), "utf8");
    }

    it("passes with a valid pattern and no flags", async () => {
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: [{ type: "regex", pattern: "def \\w+\\(" }] }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);
        const grader = suite.cases[0].assert[0];

        expect(grader).toMatchObject({ type: "regex", pattern: "def \\w+\\(" });
    });

    it("passes with a valid pattern and flags", async () => {
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: [{ type: "regex", pattern: "hello", flags: "i" }] }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);
        const grader = suite.cases[0].assert[0];

        expect(grader).toMatchObject({ type: "regex", pattern: "hello", flags: "i" });
    });

    it("throws when pattern is missing", async () => {
        await writeWithRegex({ type: "regex" });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"pattern"/);
    });

    it("throws when pattern is an invalid regex", async () => {
        await writeWithRegex({ type: "regex", pattern: "[unclosed" });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/invalid pattern/i);
    });

    it("throws when flags is a number instead of string", async () => {
        await writeWithRegex({ type: "regex", pattern: "hello", flags: 42 });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"flags"/);
    });
});

// ---------------------------------------------------------------------------
// Grader validation — llm-judge
// ---------------------------------------------------------------------------

describe("loader — llm-judge grader", () => {
    async function writeWithJudge(grader: unknown): Promise<void> {
        const s = validSuite({ cases: [{ name: "g", input: "hi", assert: [grader] }] });
        await writeFile(resolve(tmpRoot, "castari.eval.json"), JSON.stringify(s), "utf8");
    }

    it("passes with a valid rubric", async () => {
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: [{ type: "llm-judge", rubric: "Be helpful." }] }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);
        const grader = suite.cases[0].assert[0];

        expect(grader).toMatchObject({ type: "llm-judge", rubric: "Be helpful." });
    });

    it("trims whitespace from rubric", async () => {
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: [{ type: "llm-judge", rubric: "  Be helpful.  " }] }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);
        const grader = suite.cases[0].assert[0] as { rubric: string };

        expect(grader.rubric).toBe("Be helpful.");
    });

    it("throws when rubric is missing", async () => {
        await writeWithJudge({ type: "llm-judge" });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"rubric"/);
    });

    it("throws when rubric is an empty string", async () => {
        await writeWithJudge({ type: "llm-judge", rubric: "   " });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"rubric"/);
    });

    it("throws when threshold is above 1", async () => {
        await writeWithJudge({ type: "llm-judge", rubric: "Be helpful.", threshold: 1.5 });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/threshold/i);
    });

    it("throws when threshold is below 0", async () => {
        await writeWithJudge({ type: "llm-judge", rubric: "Be helpful.", threshold: -0.1 });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/threshold/i);
    });

    it("throws when threshold is exactly 0 — edge: that's valid (allow 0)", async () => {
        // 0 is a valid threshold (always pass), so this should NOT throw
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: [{ type: "llm-judge", rubric: "Be helpful.", threshold: 0 }] }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot)).resolves.toBeDefined();
    });

    it("throws when threshold is exactly 1 — edge: that's valid (require perfect score)", async () => {
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: [{ type: "llm-judge", rubric: "Be helpful.", threshold: 1 }] }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot)).resolves.toBeDefined();
    });

    it("throws when threshold is a string", async () => {
        await writeWithJudge({ type: "llm-judge", rubric: "Be helpful.", threshold: "high" });

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/threshold/i);
    });
});

// ---------------------------------------------------------------------------
// Unknown grader type
// ---------------------------------------------------------------------------

describe("loader — unknown grader type", () => {
    it("throws with the valid types listed in the error", async () => {
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: [{ type: "semantic-similarity", expected: "x" }] }],
        });
        await writeFile(resolve(tmpRoot, "castari.eval.json"), JSON.stringify(s), "utf8");

        const err = await loadEvalSuite("castari.eval.json", tmpRoot).catch((e) => e);

        expect(err).toBeInstanceOf(LoadError);
        expect(err.message).toMatch(/semantic-similarity/);
        expect(err.message).toMatch(/exact/);      // valid types listed
        expect(err.message).toMatch(/llm-judge/);
    });

    it("throws when grader has no type field at all", async () => {
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: [{ expected: "x" }] }],
        });
        await writeFile(resolve(tmpRoot, "castari.eval.json"), JSON.stringify(s), "utf8");

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(/"type"/);
    });

    it("throws when a grader is a primitive instead of an object", async () => {
        const s = validSuite({
            cases: [{ name: "g", input: "hi", assert: ["contains"] }],
        });
        await writeFile(resolve(tmpRoot, "castari.eval.json"), JSON.stringify(s), "utf8");

        await expect(loadEvalSuite("castari.eval.json", tmpRoot))
            .rejects.toThrow(LoadError);
    });
});

// ---------------------------------------------------------------------------
// Multiple graders in one case
// ---------------------------------------------------------------------------

describe("loader — multiple graders per case", () => {
    it("validates all graders and returns them all on success", async () => {
        const s = validSuite({
            cases: [{
                name: "multi",
                input: "write code",
                assert: [
                    { type: "contains", expected: "def " },
                    { type: "not-contains", expected: "error" },
                    { type: "regex", pattern: "def \\w+\\(" },
                    { type: "llm-judge", rubric: "Code should be idiomatic Python." },
                ],
            }],
        });
        await writeEvalFile(s, { withEntrypoint: true });

        const { suite } = await loadEvalSuite("castari.eval.json", tmpRoot);

        expect(suite.cases[0].assert).toHaveLength(4);
    });

    it("reports which grader index failed in the error message", async () => {
        const s = validSuite({
            cases: [{
                name: "multi",
                input: "hi",
                assert: [
                    { type: "contains", expected: "ok" },
                    { type: "regex", pattern: "[bad" }, // index 1 fails
                ],
            }],
        });
        await writeFile(resolve(tmpRoot, "castari.eval.json"), JSON.stringify(s), "utf8");

        const err = await loadEvalSuite("castari.eval.json", tmpRoot).catch((e) => e);

        expect(err.message).toMatch(/assert\[1\]/);
    });
});

// ---------------------------------------------------------------------------
// resolveFromCastariJson
// ---------------------------------------------------------------------------

describe("resolveFromCastariJson", () => {
    it("returns the resolved entrypoint path when castari.json is valid", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.json"),
            JSON.stringify({ name: "my-agent", entrypoint: "src/index.ts" }),
            "utf8"
        );

        const result = await resolveFromCastariJson(tmpRoot);

        expect(result).toBe(resolve(tmpRoot, "src/index.ts"));
    });

    it("throws LoadError when castari.json does not exist", async () => {
        await expect(resolveFromCastariJson(tmpRoot))
            .rejects.toThrow(LoadError);

        await expect(resolveFromCastariJson(tmpRoot))
            .rejects.toThrow(/castari\.json/i);
    });

    it("includes cast init hint in missing castari.json error", async () => {
        await expect(resolveFromCastariJson(tmpRoot))
            .rejects.toThrow(/cast init/i);
    });

    it("throws LoadError when castari.json is malformed JSON", async () => {
        await writeFile(resolve(tmpRoot, "castari.json"), "{ bad", "utf8");

        await expect(resolveFromCastariJson(tmpRoot))
            .rejects.toThrow(/parse/i);
    });

    it("throws LoadError when castari.json has no entrypoint field", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.json"),
            JSON.stringify({ name: "my-agent" }),
            "utf8"
        );

        await expect(resolveFromCastariJson(tmpRoot))
            .rejects.toThrow(/entrypoint/i);
    });

    it("includes instructions for fixing missing entrypoint in castari.json", async () => {
        await writeFile(
            resolve(tmpRoot, "castari.json"),
            JSON.stringify({ name: "my-agent" }),
            "utf8"
        );

        const err = await resolveFromCastariJson(tmpRoot).catch((e) => e);

        // Should mention how to fix it — either castari.json or the eval file
        expect(err.message).toMatch(/src\/index\.ts|entrypoint/i);
    });
});

// ---------------------------------------------------------------------------
// Error identity
// ---------------------------------------------------------------------------

describe("LoadError", () => {
    it("has name 'LoadError'", () => {
        const err = new LoadError("test");
        expect(err.name).toBe("LoadError");
    });

    it("is an instance of Error", () => {
        expect(new LoadError("test")).toBeInstanceOf(Error);
    });

    it("is distinguishable from generic Error in a catch block", () => {
        const err = new LoadError("test");
        expect(err instanceof LoadError).toBe(true);
        expect(new Error("test") instanceof LoadError).toBe(false);
    });
});