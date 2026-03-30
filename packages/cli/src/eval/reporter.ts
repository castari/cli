import { CaseResult, SuiteResult } from "./types.js";

const NO_COLOR = process.env.NO_COLOR !== undefined;

const c = {
    reset: (s: string) => (NO_COLOR ? s : `\x1b[0m${s}\x1b[0m`),
    bold: (s: string) => (NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`),
    dim: (s: string) => (NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`),
    green: (s: string) => (NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`),
    red: (s: string) => (NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`),
    yellow: (s: string) => (NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`),
    cyan: (s: string) => (NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`),
    gray: (s: string) => (NO_COLOR ? s : `\x1b[90m${s}\x1b[0m`),
};

const PASS = c.green("✓ PASS");
const FAIL = c.red("✗ FAIL");
const ERROR = c.yellow("⚠ ERROR");
const TIMEOUT = c.yellow("⏱ TIMEOUT");

function statusIcon(result: CaseResult): string {
    switch (result.status) {
        case "passed": return PASS;
        case "failed": return FAIL;
        case "error": return ERROR;
        case "timeout": return TIMEOUT;
    }
}

function formatMs(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function truncate(s: string, max = 200): string {
    return s.length > max ? s.slice(0, max) + "…" : s;
}

export function printCaseResult(result: CaseResult): void {
    const duration = c.gray(`(${formatMs(result.durationMs)})`);
    console.log(`  ${statusIcon(result)}  ${result.case.name} ${duration}`);

    if (result.status === "error" || result.status === "timeout") {
        console.log(c.red(`       ${result.error ?? "Unknown error"}`));
        return;
    }
    if (result.status === "failed") {
        for (const gr of result.gradersResults) {
            const icon = gr.passed ? c.green("    ✓") : c.red("    ✗");
            const graderType = c.gray(`[${gr.grader.type}]`);
            console.log(`${icon} ${graderType} ${gr.reason}`);
        }
        if (result.response !== undefined) {
            console.log(c.gray(`\n       Agent response preview:`));
            console.log(c.dim(`       ${truncate(result.response, 300).replace(/\n/g, "\n       ")}`));
        }
    }
}

export function printSuiteSummary(suiteResult: SuiteResult): void {
    const { passed, failed, errored, totalMs, suite } = suiteResult;
    const total = suiteResult.cases.length;

    console.log("");
    console.log(c.bold("─".repeat(60)));
    console.log(c.bold(`  ${suite.name}`));
    console.log(c.bold("─".repeat(60)));
    console.log("");

    for (const caseResult of suiteResult.cases) {
        printCaseResult(caseResult);
    }

    console.log("");
    console.log(c.bold("─".repeat(60)));

    const passStr = c.green(`${passed} passed`);
    const failStr = failed > 0 ? c.red(`${failed} failed`) : c.gray(`${failed} failed`);
    const errStr = errored > 0 ? c.yellow(`${errored} errored`) : c.gray(`${errored} errored`);
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    const pctColour = pct === 100 ? c.green : pct >= 70 ? c.yellow : c.red;

    console.log(
        `  ${passStr}  ${failStr}  ${errStr}  ${c.gray(`of ${total} cases`)}  ${pctColour(`(${pct}%)`)}  ${c.gray(formatMs(totalMs))}`
    );
    console.log(c.bold("─".repeat(60)));
    console.log("");
}

export function formatJsonReport(suiteResult: SuiteResult):string {
    return JSON.stringify(
    {
      suite: suiteResult.suite.name,
      passed: suiteResult.passed,
      failed: suiteResult.failed,
      errored: suiteResult.errored,
      total: suiteResult.cases.length,
      totalMs: suiteResult.totalMs,
      passRate:
        suiteResult.cases.length > 0
          ? suiteResult.passed / suiteResult.cases.length
          : 0,
      cases: suiteResult.cases.map((c_) => ({
        name: c_.case.name,
        status: c_.status,
        durationMs: c_.durationMs,
        response: c_.response,
        error: c_.error,
        graderResults: c_.gradersResults.map((g) => ({
          type: g.grader.type,
          passed: g.passed,
          reason: g.reason,
          score: g.score,
        })),
      })),
    },
    null,
    2
  );
}

export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private idx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private current = "";
 
  start(label: string): void {
    this.current = label;
    if (NO_COLOR || !process.stdout.isTTY) {
      process.stdout.write(`  … ${label}\n`);
      return;
    }
    this.timer = setInterval(() => {
      const frame = this.frames[this.idx % this.frames.length];
      process.stdout.write(`\r  ${c.cyan(frame)} ${this.current}  `);
      this.idx++;
    }, 80);
  }
 
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (process.stdout.isTTY) {
        process.stdout.write("\r" + " ".repeat(this.current.length + 10) + "\r");
      }
    }
  }
}
