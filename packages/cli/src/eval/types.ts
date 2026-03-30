
export type GraderKind =
    | "exact"
    | "contains"
    | "not-contains"
    | "regex"
    | "llm-judge";

export interface ExactGrader {
    type: "exact"
    expected: string
    caseSensitive?: boolean
}

export interface ContainsGrader {
    type: "contains";
    expected: string;
    caseSensitive?: boolean;
}

export interface NotContainsGrader {
    type: "not-contains";
    expected: string;
    caseSensitive?: boolean;
}

export interface RegexGrader {
    type: "regex";
    pattern: string;
    flags?: string;
}

export interface LLMJudgeGrader {
    type: "llm-judge";
    rubric: string;
    threshold?: number;
}

export type Grader =
    | ExactGrader
    | ContainsGrader
    | NotContainsGrader
    | RegexGrader
    | LLMJudgeGrader;

export interface EvalCase {
    name: string;
    input: string;
    assert: Grader[];
    tags?: string[];
    timeout?: number;
}

export interface EvalSuite {
    name: string;
    entrypoint?: string;
    timeout?: number;
    cases: EvalCase[];
}

export interface GraderResult {
    grader: Grader;
    passed: boolean;
    reason: string;
    score?: number;
}

export type CaseStatus = "passed" | "failed" | "timeout" | "error";

export interface CaseResult {
    case: EvalCase;
    status: CaseStatus;
    response?: string;
    error?: string;
    durationMs: number;
    gradersResults: GraderResult[];
}

export interface SuiteResult {
    suite: EvalSuite;
    cases: CaseResult[];
    totalMs: number;
    passed: number;
    failed: number;
    errored: number;
}


