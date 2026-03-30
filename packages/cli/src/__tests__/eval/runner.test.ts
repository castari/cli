import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { runSuite, type RunSuiteOptions } from "../../eval/runner.js";
import type { EvalSuite, CaseResult } from "../../eval/types.js";

// ---------------------------------------------------------------------------
// Test fixtures — tiny agent scripts written to a temp dir at runtime
// ---------------------------------------------------------------------------

let tmpRoot: string;

beforeEach(async () => {
    tmpRoot = resolve(tmpdir(), `castari-eval-test-${Date.now()}-${Math.random().toString(36).substring(2)}`);
    await mkdir(tmpRoot, { recursive: true });
});

afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

/**
 * Write a minimal agent entrypoint to the temp dir.
 * The agent reads process.argv[2] as the prompt and writes to stdout.
 */
async function writeAgent(filename: string, script: string): Promise<string> {
    const path = resolve(tmpRoot, filename);
    await writeFile(path, script, "utf8");
    return path;
}

/** Write a castari.json pointing at the given entrypoint */
async function writeCastariJson(entrypoint: string): Promise<void> {
    await writeFile(
        resolve(tmpRoot, "castari.json"),
        JSON.stringify({ name: "test-agent", entrypoint, version: "0.0.1" }),
        "utf8"
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function suite(overrides: Partial<EvalSuite> & { entrypoint: string }): EvalSuite {
    return {
        name: "Test Suite",
        timeout: 8_000,
        cases: [],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Basic pass / fail
// ---------------------------------------------------------------------------

describe("runSuite — basic pass/fail", () => {
    it("marks a case as pass when all graders succeed", async () => {
        const entrypoint = await writeAgent(
            "echo-agent.mjs",
            `process.stdout.write("Hello, world!");`
        );

        const result = await runSuite(
            suite({
                entrypoint,
                cases: [
                    {
                        name: "contains hello",
                        input: "say hello",
                        assert: [{ type: "contains", expected: "Hello" }],
                    },
                ],
            }),
            tmpRoot
        );

        expect(result.passed).toBe(1);
        expect(result.failed).toBe(0);
        expect(result.cases[0].status).toBe("passed");
        expect(result.cases[0].response).toBe("Hello, world!");
    });

    it("marks a case as fail when a grader fails", async () => {
        const entrypoint = await writeAgent(
            "bye-agent.mjs",
            `process.stdout.write("Goodbye!");`
        );

        const result = await runSuite(
            suite({
                entrypoint,
                cases: [
                    {
                        name: "expects hello but gets goodbye",
                        input: "say hello",
                        assert: [{ type: "contains", expected: "Hello" }],
                    },
                ],
            }),
            tmpRoot
        );

        expect(result.passed).toBe(0);
        expect(result.failed).toBe(1);
        expect(result.cases[0].status).toBe("failed");
    });

    it("reports individual grader results on failure", async () => {
        const entrypoint = await writeAgent(
            "partial-agent.mjs",
            `process.stdout.write("def add(a, b): pass");`
        );

        const result = await runSuite(
            suite({
                entrypoint,
                cases: [
                    {
                        name: "code check",
                        input: "write add function",
                        assert: [
                            { type: "contains", expected: "def " },    // passes
                            { type: "contains", expected: "return" },  // fails — no return
                        ],
                    },
                ],
            }),
            tmpRoot
        );

        const caseResult = result.cases[0];
        expect(caseResult.gradersResults).toHaveLength(2);
        expect(caseResult.gradersResults[0].passed).toBe(true);
        expect(caseResult.gradersResults[1].passed).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("runSuite — error handling", () => {
    it("marks a case as error when the agent exits non-zero", async () => {
        const entrypoint = await writeAgent(
            "crash-agent.mjs",
            `process.stderr.write("fatal error"); process.exit(1);`
        );

        const result = await runSuite(
            suite({
                entrypoint,
                cases: [{ name: "crash case", input: "anything", assert: [{ type: "contains", expected: "ok" }] }],
            }),
            tmpRoot
        );

        expect(result.cases[0].status).toBe("error");
        expect(result.errored).toBe(1);
        expect(result.cases[0].error).toMatch(/exit(ed)? with code 1/i);
    });

    it("marks a case as timeout when agent exceeds timeout", async () => {
        const entrypoint = await writeAgent(
            "slow-agent.mjs",
            // Sleep for 10 seconds — well beyond the 500ms timeout we set
            `await new Promise(r => setTimeout(r, 10_000));`
        );

        const result = await runSuite(
            suite({
                entrypoint,
                timeout: 500,
                cases: [{ name: "slow case", input: "hello", assert: [{ type: "contains", expected: "ok" }] }],
            }),
            tmpRoot
        );

        expect(result.cases[0].status).toBe("timeout");
        expect(result.cases[0].error).toMatch(/timed out/i);
    }, 10_000);

    it("throws when entrypoint file does not exist", async () => {
        await expect(
            runSuite(
                suite({
                    entrypoint: "nonexistent/agent.mjs",
                    cases: [{ name: "x", input: "y", assert: [{ type: "contains", expected: "z" }] }],
                }),
                tmpRoot
            )
        ).rejects.toThrow(/not found/i);
    });
});

// ---------------------------------------------------------------------------
// castari.json fallback
// ---------------------------------------------------------------------------

describe("runSuite — castari.json fallback", () => {
    it("reads entrypoint from castari.json when suite has none", async () => {
        const entrypoint = await writeAgent(
            "auto-agent.mjs",
            `process.stdout.write("auto response");`
        );
        await writeCastariJson(entrypoint);

        // Note: no entrypoint in suite
        const result = await runSuite(
            {
                name: "Auto suite",
                timeout: 5_000,
                cases: [
                    {
                        name: "auto case",
                        input: "test",
                        assert: [{ type: "contains", expected: "auto" }],
                    },
                ],
            },
            tmpRoot
        );

        expect(result.passed).toBe(1);
    });

    it("throws a clear error when castari.json is missing and no entrypoint in suite", async () => {
        // No castari.json written, no entrypoint in suite
        await expect(
            runSuite(
                { name: "No config suite", timeout: 5_000, cases: [{ name: "x", input: "y", assert: [] }] },
                tmpRoot
            )
        ).rejects.toThrow(/castari\.json/i);
    });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe("runSuite — filtering", () => {
    async function multiCaseSuite(entrypoint: string): Promise<EvalSuite> {
        return {
            name: "Filter Suite",
            entrypoint,
            timeout: 5_000,
            cases: [
                {
                    name: "smoke: hello",
                    input: "hello",
                    tags: ["smoke"],
                    assert: [{ type: "contains", expected: "ok" }],
                },
                {
                    name: "safety: no swearing",
                    input: "say a bad word",
                    tags: ["safety"],
                    assert: [{ type: "not-contains", expected: "badword" }],
                },
                {
                    name: "code: write function",
                    input: "write function",
                    tags: ["code"],
                    assert: [{ type: "contains", expected: "def" }],
                },
            ],
        };
    }

    it("runs only cases matching --tag", async () => {
        const entrypoint = await writeAgent("ok-agent.mjs", `process.stdout.write("ok");`);
        const s = await multiCaseSuite(entrypoint);

        const result = await runSuite(s, tmpRoot, { tags: ["smoke"] });

        expect(result.cases).toHaveLength(1);
        expect(result.cases[0].case.name).toBe("smoke: hello");
    });

    it("runs only cases matching --filter substring", async () => {
        const entrypoint = await writeAgent("ok-agent2.mjs", `process.stdout.write("ok");`);
        const s = await multiCaseSuite(entrypoint);

        const result = await runSuite(s, tmpRoot, { filter: "safety" });

        expect(result.cases).toHaveLength(1);
        expect(result.cases[0].case.name).toContain("safety");
    });

    it("is case-insensitive for --filter", async () => {
        const entrypoint = await writeAgent("ok-agent3.mjs", `process.stdout.write("ok");`);
        const s = await multiCaseSuite(entrypoint);

        const result = await runSuite(s, tmpRoot, { filter: "SMOKE" });

        expect(result.cases).toHaveLength(1);
    });

    it("throws when no cases match filters", async () => {
        const entrypoint = await writeAgent("ok-agent4.mjs", `process.stdout.write("ok");`);
        const s = await multiCaseSuite(entrypoint);

        await expect(
            runSuite(s, tmpRoot, { tags: ["nonexistent-tag"] })
        ).rejects.toThrow(/no test cases matched/i);
    });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe("runSuite — concurrency", () => {
    it("runs all cases and collects all results with concurrency > 1", async () => {
        const entrypoint = await writeAgent(
            "concurrent-agent.mjs",
            // Echo back the prompt so each case can assert on its own input
            `process.stdout.write(process.argv[2] ?? "");`
        );

        const cases = Array.from({ length: 5 }, (_, i) => ({
            name: `case ${i}`,
            input: `input-${i}`,
            assert: [{ type: "contains" as const, expected: `input-${i}` }],
        }));

        const result = await runSuite(
            { name: "Concurrent suite", entrypoint, timeout: 5_000, cases },
            tmpRoot,
            { concurrency: 3 }
        );

        expect(result.cases).toHaveLength(5);
        expect(result.passed).toBe(5);
        expect(result.failed).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe("runSuite — progress callbacks", () => {
    it("calls onCaseStart and onCaseEnd for each case", async () => {
        const entrypoint = await writeAgent(
            "callback-agent.mjs",
            `process.stdout.write("done");`
        );

        const started: string[] = [];
        const ended: CaseResult[] = [];

        await runSuite(
            {
                name: "Callback suite",
                entrypoint,
                timeout: 5_000,
                cases: [
                    { name: "case A", input: "a", assert: [{ type: "contains", expected: "done" }] },
                    { name: "case B", input: "b", assert: [{ type: "contains", expected: "done" }] },
                ],
            },
            tmpRoot,
            {
                onCaseStart: (name) => started.push(name),
                onCaseEnd: (result) => ended.push(result),
            }
        );

        expect(started).toEqual(["case A", "case B"]);
        expect(ended).toHaveLength(2);
        expect(ended.every((r) => r.status === "passed")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// SuiteResult shape
// ---------------------------------------------------------------------------

describe("runSuite — result totals", () => {
    it("correctly counts passed / failed / errored", async () => {
        const entrypoint = await writeAgent(
            "mixed-agent.mjs",
            // Echo argv[2]; the calling test controls what gets written
            `process.stdout.write(process.argv[2] ?? "");`
        );

        const result = await runSuite(
            {
                name: "Mixed suite",
                entrypoint,
                timeout: 5_000,
                cases: [
                    // passes
                    { name: "pass case", input: "hello", assert: [{ type: "contains", expected: "hello" }] },
                    // fails
                    { name: "fail case", input: "hello", assert: [{ type: "contains", expected: "world" }] },
                ],
            },
            tmpRoot
        );

        expect(result.passed).toBe(1);
        expect(result.failed).toBe(1);
        expect(result.errored).toBe(0);
        expect(result.cases).toHaveLength(2);
        expect(result.totalMs).toBeGreaterThan(0);
    });
});