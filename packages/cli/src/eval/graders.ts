import type {
    Grader,
    GraderResult,
    ExactGrader,
    ContainsGrader,
    NotContainsGrader,
    RegexGrader,
    LLMJudgeGrader,
} from "./types.js";

function gradeExact(grader: ExactGrader, response: string): GraderResult {
    const a = grader.caseSensitive ? response : response.toLowerCase();
    const b = grader.caseSensitive ? grader.expected : grader.expected.toLowerCase();

    const passed = a.trim() === b.trim();
    return {
        grader,
        passed,
        reason: passed
            ? `Response exactly matches expected output`
            : `Expected: "${grader.expected}" but got: "${response.slice(0, 120)}${response.length > 120 ? "…" : ""}"`,
    }
}

function gradeContains(grader: ContainsGrader, response: string): GraderResult {
    const haystack = grader.caseSensitive ? response : response.toLowerCase();
    const needle = grader.caseSensitive ? grader.expected : grader.expected.toLowerCase();

    const passed = haystack.includes(needle);
    return {
        grader,
        passed,
        reason: passed
            ? `Response contains "${grader.expected}"`
            : `Response does not contain "${grader.expected}"`,
    }
}

function gradeNotContains(grader: NotContainsGrader, response: string): GraderResult {
    const haystack = grader.caseSensitive ? response : response.toLowerCase();
    const needle = grader.caseSensitive ? grader.expected : grader.expected.toLowerCase();
    const passed = !haystack.includes(needle);
    return {
        grader,
        passed,
        reason: passed
            ? `Response does not contain "${grader.expected}"`
            : `Response should not contain "${grader.expected}" but it does.`,
    }
}

function gradeRegex(grader: RegexGrader, response: string): GraderResult {
    let passed = false;
    let reason = "";

    try {
        const regex = new RegExp(grader.pattern, grader.flags);
        passed = regex.test(response);
        reason = passed
            ? `Response matches pattern /${grader.pattern}/${grader.flags ?? ""}`
            : `Response does not match pattern /${grader.pattern}/${grader.flags ?? ""}`;
    } catch (err) {
        reason = `Invalid regex pattern /${grader.pattern}/${grader.flags ?? ""}: ${(err as Error).message}`;
    }
    return { grader, passed, reason };
}

/**
 * LLM-as-judge grader using any OpenAI-compatible chat completion endpoint.
 *
 * Configure via environment variables:
 *
 *   CASTARI_API_KEY        – Required. API key for the provider.
 *   CASTARI_LLM_BASE_URL   – Base URL of the OpenAI-compatible API.
 *                            Default: https://api.groq.com/openai/v1  (free tier, no credit card)
 *                            Alternatives:
 *                              Ollama (local):  http://localhost:11434/v1
 *                              OpenAI:          https://api.openai.com/v1
 *   CASTARI_LLM_MODEL      – Model to use.
 *                            Default: llama-3.1-8b-instant  (fast & free on Groq)
 *
 * Get a free Groq key at: https://console.groq.com
 */
async function gradeLLMJudge(grader: LLMJudgeGrader, prompt: string, response: string): Promise<GraderResult> {
    const threshold = grader.threshold ?? 0.7;
    const apiKey = process.env.CASTARI_API_KEY;

    if (!apiKey) {
        return {
            grader,
            passed: false,
            reason:
                "llm-judge requires an API key. Set CASTARI_API_KEY (get a free one at https://console.groq.com).",
            score: 0,
        };
    }

    const baseUrl = (process.env.CASTARI_LLM_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
    const model = process.env.CASTARI_LLM_MODEL ?? "llama-3.1-8b-instant";

    const systemPrompt =
        "You are an impartial evaluator grading an AI agent's response.\n" +
        "You will be given a rubric, the original user prompt, and the agent's response.\n" +
        "Score the response from 0.0 to 1.0 based on how well it satisfies the rubric.\n" +
        'Reply ONLY with a JSON object in this exact format:\n' +
        '{"score": <number 0-1>, "reason": "<one sentence explanation>"}';

    const userMessage = `Rubric: ${grader.rubric}\n\nUser Prompt: ${prompt}\n\nAgent Response: ${response}`;

    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                max_tokens: 256,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
            }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            return {
                grader,
                passed: false,
                reason: `LLM judge API error (${baseUrl}): ${res.status} ${res.statusText}: ${errorText}`,
                score: 0,
            };
        }

        const data = (await res.json()) as {
            choices: Array<{ message: { content: string } }>;
        };
        const text = data.choices[0]?.message?.content ?? "";
        const parsed = JSON.parse(text) as { score: number; reason: string };
        const score = Math.max(0, Math.min(1, parsed.score));
        const passed = score >= threshold;
        return {
            grader,
            passed,
            reason: `Score ${score.toFixed(2)} (threshold ${threshold}): ${parsed.reason}`,
            score,
        };
    } catch (err) {
        return {
            grader,
            passed: false,
            reason: `LLM judge failed: ${(err as Error).message}`,
            score: 0,
        };
    }
}

export async function runGraders(graders: Grader[], prompt: string, response: string): Promise<GraderResult[]> {
    const results: GraderResult[] = [];
    for (const grader of graders) {
        switch (grader.type) {
            case "exact":
                results.push(gradeExact(grader, response));
                break;
            case "contains":
                results.push(gradeContains(grader, response));
                break;
            case "not-contains":
                results.push(gradeNotContains(grader, response));
                break;
            case "regex":
                results.push(gradeRegex(grader, response));
                break;
            case "llm-judge":
                results.push(await gradeLLMJudge(grader, prompt, response));
                break;
            default: {
                const exhaustiveCheck: never = grader;
                results.push({
                    grader: exhaustiveCheck,
                    passed: false,
                    reason: `Unknown grader type: ${(exhaustiveCheck as Grader).type}`,
                });
            }
        }
    }
    return results;
}