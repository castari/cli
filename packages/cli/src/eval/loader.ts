import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EvalSuite, EvalCase, Grader } from "./types.js";

export interface LoadResult {
    suite: EvalSuite;
    filePath: string;
    entrypoint: string;
}

export class LoadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LoadError";
    }
}

export async function loadEvalSuite(evalFilePath: string, projectRoot: string): Promise<LoadResult> {
    const filePath = resolve(projectRoot, evalFilePath);
    if (!existsSync(filePath)) {
        throw new LoadError(
            `Eval file not found: ${filePath}\n\n` +
            `  Run \`cast eval-init\` to scaffold one, or pass a custom path:\n` +
            `    cast eval --file path/to/my.eval.json`
        );
    }

    let raw: string;
    try {
        raw = await readFile(filePath, "utf-8");
    } catch (err) {
        throw new LoadError(`Could not read ${filePath}: ${(err as Error).message}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new LoadError(`${filePath} is not valid JSON: ${(err as Error).message}`);
    }

    const suite = validateAndFillSuite(parsed, filePath);
    const entrypoint = suite.entrypoint ? resolveRelative(projectRoot, suite.entrypoint, '"entrypoint" in eval file ') : await resolveFromCastariJson(projectRoot);

    if (!existsSync(entrypoint)) {
        throw new LoadError(
            `Agent entrypoint not found: ${entrypoint}\n\n` +
            `  Check the "entrypoint" in castari.json or set it directly in ${evalFilePath}.`
        );
    }

    return { suite, filePath, entrypoint };
}

const VALID_GRADER_TYPES = new Set(["exact", "contains", "not-contains", "regex", "llm-judge"]);

function validateAndFillSuite(raw: unknown, filePath: string): EvalSuite {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new LoadError(`${filePath}: expected a JSON object at the top level`);
    }

    const obj = raw as Record<string, any>;

    if (typeof obj.name !== "string" || obj.name.trim() === "") {
        throw new LoadError(`${filePath}: "name" must be a non-empty string`);
    }

    if (obj.timeout !== undefined && !isPositiveInteger(obj.timeout)) {
        throw new LoadError(`${filePath}: "timeout" must be a positive integer (milliseconds)`);
    }

    if (obj.entrypoint !== undefined && typeof obj.entrypoint !== "string") {
        throw new LoadError(`${filePath}: "entrypoint" must be a string path`);
    }

    if (!Array.isArray(obj.cases)) {
        throw new LoadError(`${filePath}: "cases" must be an array`);
    }

    if (obj.cases.length === 0) {
        throw new LoadError(`${filePath}: "cases" must contain at least one test case`);
    }

    const cases: EvalCase[] = obj.cases.map((c: unknown, i: number) => validateAndFillCase(c, i, filePath));

    return {
        name: obj.name.trim(),
        entrypoint: obj.entrypoint as string | undefined,
        timeout: (obj.timeout as number | undefined) ?? 30_000,
        cases,
    };
}

function validateAndFillCase(raw: unknown, index: number, filePath: string): EvalCase {
    const loc = `${filePath} cases[${index}]`;

    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new LoadError(`${loc}: each case must be a JSON object`);
    }
    const obj = raw as Record<string, any>;

    if (typeof obj.name !== "string" || obj.name.trim() === "") {
        throw new LoadError(`${loc}: "name" must be a non-empty string`);
    }

    // input
    if (typeof obj.input !== "string" || obj.input.trim() === "") {
        throw new LoadError(`${loc} ("${obj.name}"): "input" must be a non-empty string`);
    }

    // assert
    if (!Array.isArray(obj.assert)) {
        throw new LoadError(`${loc} ("${obj.name}"): "assert" must be an array of graders`);
    }

    if (obj.assert.length === 0) {
        throw new LoadError(
            `${loc} ("${obj.name}"): "assert" must contain at least one grader.\n` +
            `  Hint: use { "type": "contains", "expected": "..." } as a starting point.`
        );
    }

    const assert: Grader[] = obj.assert.map((g: unknown, gi: number) =>
        validateGrader(g, gi, obj.name as string, filePath)
    );

    // tags (optional)
    if (obj.tags !== undefined) {
        if (!Array.isArray(obj.tags) || !obj.tags.every((t) => typeof t === "string")) {
            throw new LoadError(`${loc} ("${obj.name}"): "tags" must be an array of strings`);
        }
    }

    // timeout (optional)
    if (obj.timeout !== undefined && !isPositiveInteger(obj.timeout)) {
        throw new LoadError(
            `${loc} ("${obj.name}"): "timeout" must be a positive integer (milliseconds)`
        );
    }

    return {
        name: obj.name.trim(),
        input: obj.input.trim(),
        assert,
        tags: obj.tags as string[] | undefined,
        timeout: obj.timeout as number | undefined,
    };
}

function validateGrader(raw: unknown, index: number, caseName: string, filepath: string): Grader {
    const loc = `${filepath} cases[*] ("${caseName}") assert[${index}]`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new LoadError(`${loc}: each grader must be a JSON object`);
    }
    const obj = raw as Record<string, any>;
    if (typeof obj.type !== "string" || !VALID_GRADER_TYPES.has(obj.type)) {
        const unknownType = typeof obj.type === "string" ? ` Unknown type: "${obj.type}".` : "";
        throw new LoadError(`${loc}: "type" must be one of ${[...VALID_GRADER_TYPES].join(", ")}.${unknownType}`);
    }
    switch (obj.type) {
        case "exact":
        case "contains":
        case "not-contains": {
            if (typeof obj.expected !== "string") {
                throw new LoadError(`${loc} (type: ${obj.type}): "expected" must be a string`);
            }
            if (obj.caseSensitive !== undefined && typeof obj.caseSensitive !== "boolean") {
                throw new LoadError(`${loc} (type: ${obj.type}): "caseSensitive" must be a boolean if provided`);
            }
            return {
                type: obj.type,
                expected: obj.expected,
                caseSensitive: obj.caseSensitive as boolean | undefined,
            };
        }
        case "regex": {
            if (typeof obj.pattern !== "string") {
                throw new LoadError(`${loc} (type: regex): "pattern" must be a string`);
            }
            if (obj.flags !== undefined && typeof obj.flags !== "string") {
                throw new LoadError(`${loc} (type: regex): "flags" must be a string if provided`);
            }
            try {
                new RegExp(obj.pattern, (obj.flags as string | undefined) ?? "");
            } catch (err) {
                throw new LoadError(`${loc} (regex): invalid pattern "/${obj.pattern}/${obj.flags ?? ""}": ${(err as Error).message}`)
            }
            return {
                type: "regex",
                pattern: obj.pattern,
                flags: obj.flags as string | undefined,
            };
        }
        case "llm-judge": {
            if (typeof obj.rubric !== "string" || obj.rubric.trim() === "") {
                throw new LoadError(`${loc} (type: llm-judge): "rubric" must be a non-empty string`);
            }
            if (obj.threshold !== undefined && (typeof obj.threshold !== "number" || obj.threshold < 0 || obj.threshold > 1)) {
                throw new LoadError(`${loc} (type: llm-judge): "threshold" must be a number between 0 and 1`);
            }
            return {
                type: "llm-judge",
                rubric: obj.rubric.trim(),
                threshold: obj.threshold as number | undefined,
            };
        };
    }
    throw new LoadError(`${loc}: unknown grader type "${obj.type}"`);
}

interface CastariConfig {
    entrypoint?: string;
    name?: string;
}

export async function resolveFromCastariJson(projectRoot: string): Promise<string> {
    const castariJsonPath = resolve(projectRoot, "castari.json");
    if (!existsSync(castariJsonPath)) {
        throw new LoadError(
            `No castari.json found in project root (${projectRoot}).\n` +
            ` Run  \`cast init\` to create one , or set the "entrypoint" directly in your eval file.`
        );
    }
    let config: CastariConfig;
    try {
        const raw = await readFile(castariJsonPath, "utf-8");
        config = JSON.parse(raw) as CastariConfig;
    } catch (err) {
        throw new LoadError(`Failed to read or parse castari.json: ${(err as Error).message}`);
    }
    if (!config.entrypoint || typeof config.entrypoint !== "string") {
        throw new LoadError(
            `castari.json is missing an "entrypoint" field.\n\n` +
            `  Add it to castari.json:\n` +
            `    { "entrypoint": "src/index.ts" }\n\n` +
            `  Or set it directly in your castari.eval.json.`
        );
    }

    return resolveRelative(projectRoot, config.entrypoint, '"entrypoint" in castari.json');
}

// function isObject(v: unknown): v is Record<string, unknown> {
//   return typeof v === "object" && v !== null && !Array.isArray(v);
// }
 
function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}
 
function resolveRelative(root: string, rel: string, label: string): string {
  try {
    return resolve(root, rel);
  } catch {
    throw new LoadError(`Could not resolve ${label} path "${rel}" relative to ${root}`);
  }
}


