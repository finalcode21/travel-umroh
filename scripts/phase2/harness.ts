/** Minimal test harness for Phase 2 validation (no external test framework). */

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

export function record(name: string, passed: boolean, error?: string) {
  results.push({ name, passed, error });
  const mark = passed ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${passed ? "" : ` — ${error}`}`);
}

export function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`);
  }
}

/** Runs an async test case, recording pass/fail. */
export async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e instanceof Error ? e.message : String(e));
  }
}

export function printSummary(suite: string): number {
  const failed = results.filter((r) => !r.passed);
  console.log(`\n=== ${suite}: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
  }
  return failed.length;
}
