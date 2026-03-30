import {spawn} from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { EvalSuite, EvalCase, CaseResult, SuiteResult } from "./types.js";
import { runGraders } from "./graders.js";
import { resolveFromCastariJson } from "./loader.js";


function invokeAgent(
    entrypoint: string,
    prompt: string,
    timeoutMs: number
): Promise<{ response: string; durationMs: number }> {
    return new Promise((resolve_p, reject) => {
        const start = Date.now();

        const runner = entrypoint.endsWith(".ts") ? "npx" : "node";
        const args = entrypoint.endsWith(".ts") ? ["tsx", entrypoint, prompt] : [entrypoint, prompt];

        const child = spawn(runner, args, {
            env: { ...process.env },
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        })

        const timer = setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error(`Agent timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.on("close", (code) => {
            clearTimeout(timer);
            const durationMs = Date.now() - start;

            if (code !== 0) {
                reject(
                    new Error(
                        `Agent exited with code ${code}. Stderr: ${stderr.slice(0, 500)}`
                    )
                );
                return;
            }

            resolve_p({ response: stdout.trim(), durationMs });
        });
        child.on("error", (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function runCase(
    evalCase: EvalCase,
    entrypoint: string,
    defaultTimeoutMs: number,
    onProgress?: (name: string, status: "running" | "done") => void
): Promise<CaseResult> {
    const timeoutMs = evalCase.timeout ?? defaultTimeoutMs;
    onProgress?.(evalCase.name, "running");
    try {
        const { response, durationMs } = await invokeAgent(entrypoint, evalCase.input, timeoutMs);
        const gradersResults = await runGraders(evalCase.assert, evalCase.input, response);
        const allPassed = gradersResults.every(r => r.passed);
        onProgress?.(evalCase.name, "done");
        return {
            case: evalCase,
            status: allPassed ? "passed" : "failed",
            response,
            durationMs,
            gradersResults,
        }
    } catch (err) {
        const msg = (err as Error).message;
        onProgress?.(evalCase.name, "done");

        const isTimeout = msg.includes("timed out");
        return {
            case: evalCase,
            status: isTimeout ? "timeout" : "error",
            durationMs: evalCase.timeout ?? defaultTimeoutMs,
            gradersResults: [],
            error: msg,
        }
    }
}

export interface RunSuiteOptions {
    tags?: string[];
    filter?: string;
    concurrency?: number;
    entrypoint?: string;
    onCaseStart?: (name: string) => void;
    onCaseEnd?: (result: CaseResult) => void
}

export async function runSuite(
    suite: EvalSuite,
    projectRoot: string,
    options: RunSuiteOptions = {}
): Promise<SuiteResult> {
    const {
        tags,
        filter,
        concurrency = 1,
        entrypoint: entrypointOverride,
        onCaseStart,
        onCaseEnd,
    } = options;
    const entrypoint = entrypointOverride ?? (suite.entrypoint ? resolve(projectRoot, suite.entrypoint) : await resolveFromCastariJson(projectRoot));
    if (!existsSync(entrypoint)) {
        throw new Error(
            `Agent entrypoint not found: ${entrypoint}\n` +
            `Set "entrypoint" in castari.eval.json or ensure castari.json has a valid entrypoint.`
        );
    }
    const defaultTimeout = suite.timeout ?? 30000;
    let cases = suite.cases;
    if (tags && tags.length > 0) {
        cases = cases.filter((c) =>c.tags?.some(t => tags.includes(t)));
    }
    if (filter) {
        const lower = filter.toLowerCase();
        cases = cases.filter((c) => c.name.toLowerCase().includes(lower));
    }
    if (cases.length === 0) {
        throw new Error("No test cases matched the provided filters.");
    }

    const suiteStart = Date.now();
    const results: CaseResult[] = [];

    const queue = [...cases];
    const running: Promise<void>[] = [];

    async function runNext(): Promise<void> {
        const evalCase = queue.shift();
        if (!evalCase) return;

        onCaseStart?.(evalCase.name);
        const result = await runCase(evalCase, entrypoint, defaultTimeout);
        results.push(result);
        onCaseEnd?.(result);
        if (queue.length > 0) {
            await runNext();
        }
    }

    const workers = Math.min(concurrency, cases.length);
    for (let i = 0; i < workers; i++) {
        running.push(runNext());
    }

    await Promise.all(running);

    const totalMs = Date.now() - suiteStart;
    const passed = results.filter((r) => r.status === "passed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const errored = results.filter(
        (r) => r.status === "error" || r.status === "timeout"
    ).length;

    return{ suite, cases: results, totalMs, passed, failed, errored};
}