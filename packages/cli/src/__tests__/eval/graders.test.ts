import { describe, it, expect, vi } from "vitest";
import { runGraders } from "../../eval/graders.js";
import type { Grader } from "../../eval/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function grade(graders: Grader[], response: string, prompt = "test prompt") {
    return runGraders(graders, prompt, response);
}

// ---------------------------------------------------------------------------
// exact grader
// ---------------------------------------------------------------------------

describe("exact grader", () => {
    it("passes when response matches expected (case-insensitive by default)", async () => {
        const [result] = await grade(
            [{ type: "exact", expected: "Hello World" }],
            "hello world"
        );
        expect(result.passed).toBe(true);
    });

    it("fails when response does not match", async () => {
        const [result] = await grade(
            [{ type: "exact", expected: "Hello World" }],
            "Hi there"
        );
        expect(result.passed).toBe(false);
    });

    it("respects caseSensitive flag", async () => {
        const [result] = await grade(
            [{ type: "exact", expected: "Hello World", caseSensitive: true }],
            "hello world"
        );
        expect(result.passed).toBe(false);
    });

    it("trims whitespace before comparing", async () => {
        const [result] = await grade(
            [{ type: "exact", expected: "hello" }],
            "  hello  "
        );
        expect(result.passed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// contains grader
// ---------------------------------------------------------------------------

describe("contains grader", () => {
    it("passes when response contains expected string", async () => {
        const [result] = await grade(
            [{ type: "contains", expected: "python" }],
            "Here is some Python code: def hello():"
        );
        expect(result.passed).toBe(true);
    });

    it("fails when string is absent", async () => {
        const [result] = await grade(
            [{ type: "contains", expected: "python" }],
            "Here is some JavaScript code"
        );
        expect(result.passed).toBe(false);
    });

    it("is case-insensitive by default", async () => {
        const [result] = await grade(
            [{ type: "contains", expected: "Python" }],
            "here is some python code"
        );
        expect(result.passed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// not-contains grader
// ---------------------------------------------------------------------------

describe("not-contains grader", () => {
    it("passes when response does NOT contain forbidden string", async () => {
        const [result] = await grade(
            [{ type: "not-contains", expected: "error" }],
            "The operation completed successfully."
        );
        expect(result.passed).toBe(true);
    });

    it("fails when response contains the forbidden string", async () => {
        const [result] = await grade(
            [{ type: "not-contains", expected: "error" }],
            "An error occurred during processing."
        );
        expect(result.passed).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// regex grader
// ---------------------------------------------------------------------------

describe("regex grader", () => {
    it("passes when response matches pattern", async () => {
        const [result] = await grade(
            [{ type: "regex", pattern: "def \\w+\\(" }],
            "def hello_world():\n    pass"
        );
        expect(result.passed).toBe(true);
    });

    it("fails when pattern does not match", async () => {
        const [result] = await grade(
            [{ type: "regex", pattern: "def \\w+\\(" }],
            "function helloWorld() {}"
        );
        expect(result.passed).toBe(false);
    });

    it("respects flags", async () => {
        const [result] = await grade(
            [{ type: "regex", pattern: "HELLO", flags: "i" }],
            "hello world"
        );
        expect(result.passed).toBe(true);
    });

    it("handles invalid regex gracefully", async () => {
        const [result] = await grade(
            [{ type: "regex", pattern: "[invalid" }],
            "any response"
        );
        expect(result.passed).toBe(false);
        expect(result.reason).toContain("Invalid regex");
    });
});

// ---------------------------------------------------------------------------
// multiple graders
// ---------------------------------------------------------------------------

describe("multiple graders", () => {
    it("all must pass for the suite to pass", async () => {
        const graders: Grader[] = [
            { type: "contains", expected: "def " },
            { type: "contains", expected: "return" },
            { type: "not-contains", expected: "syntax error" },
        ];

        const results = await grade(
            graders,
            "def add(a, b):\n    return a + b"
        );

        expect(results).toHaveLength(3);
        expect(results.every((r) => r.passed)).toBe(true);
    });

    it("reports individual grader failures", async () => {
        const graders: Grader[] = [
            { type: "contains", expected: "def " },
            { type: "contains", expected: "return" },
        ];

        const results = await grade(graders, "function add(a, b) { return a + b; }");

        expect(results[0].passed).toBe(false); // no "def "
        expect(results[1].passed).toBe(true);  // "return" is present
    });
});

// ---------------------------------------------------------------------------
// llm-judge grader (mocked)
// ---------------------------------------------------------------------------

describe("llm-judge grader", () => {
    it("returns fail with reason when no API key is set", async () => {
        const originalKey = process.env.CASTARI_API_KEY;
        delete process.env.CASTARI_API_KEY;

        const [result] = await grade(
            [{ type: "llm-judge", rubric: "The answer should be clear and concise." }],
            "This is my response"
        );

        expect(result.passed).toBe(false);
        expect(result.reason).toContain("API key");

        // Restore
        if (originalKey) process.env.CASTARI_API_KEY = originalKey;
    });

    it("uses default threshold of 0.7", async () => {
        // We test the threshold logic by mocking fetch
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({ score: 0.65, reason: "Partially satisfies rubric" }),
                        },
                    },
                ],
            }),
        });

        const original = global.fetch;
        global.fetch = fetchMock as unknown as typeof fetch;
        process.env.CASTARI_API_KEY = "test-key";

        try {
            const [result] = await grade(
                [{ type: "llm-judge", rubric: "Be helpful." }],
                "I can help you with that."
            );

            expect(result.passed).toBe(false); // 0.65 < 0.7
            expect(result.score).toBeCloseTo(0.65);
        } finally {
            global.fetch = original;
            delete process.env.CASTARI_API_KEY;
        }
    });

    it("passes when score meets threshold", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({ score: 0.9, reason: "Excellent response" }),
                        },
                    },
                ],
            }),
        });

        const original = global.fetch;
        global.fetch = fetchMock as unknown as typeof fetch;
        process.env.CASTARI_API_KEY = "test-key";

        try {
            const [result] = await grade(
                [{ type: "llm-judge", rubric: "Be helpful.", threshold: 0.8 }],
                "I can absolutely help you with that!"
            );

            expect(result.passed).toBe(true);
            expect(result.score).toBeCloseTo(0.9);
        } finally {
            global.fetch = original;
            delete process.env.CASTARI_API_KEY;
        }
    });
});