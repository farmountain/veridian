/**
 * The three deliberate defects of the environment-twin demo, as *textual* overlays on a correct probe.
 *
 * The mechanics - a block written with `\n` matched against a file a checkout wrote with CRLF, a state
 * of `unknown` refused rather than guessed at, and the rule that blocks must not nest - live in
 * `../defect-text.ts` and are shared with every other example. This file owns only the three edits,
 * and all three are overlays on one program because that is where the behaviour is: a defect table
 * that patched two files would need two tables and two injections, and the demo could no longer say
 * "the probe is in a recognised state" about one artifact.
 *
 * ## What makes this world's defects different in kind
 *
 * Every other demo injects a defect into *what an application produced* - a page reading, a row, a
 * record held by a substitute, a file on disk. These three are defects in **an instrument**. They do
 * not make the application behave wrongly; they make the probe *report the machine wrongly*, or fail
 * to report it at all. That is a category no earlier demo could reach, because no earlier demo judged
 * the machine the run stands on.
 *
 * It is also why this table is the sharpest one in the repository. An application that is wrong
 * fails a criterion and an operator sees it. An instrument that is wrong **passes every criterion
 * there is**, because a probe with a broken half reports a confident answer about a machine it never
 * measured. The contract defends against this with structure rather than with trust - the control
 * must be live, every capability must carry evidence, and the two-stage probes must record both
 * halves - and these three defects are each an attack on one of those defences.
 *
 * ## What the run measured, as against what this table first claimed
 *
 *   D1 -> AC-002, AC-008   a capability is reported with no evidence behind it. This is the headline,
 *                          and it is the defect the whole example exists to make visible: the report
 *                          still names eight capabilities and still answers, and is still not evidence
 *                          of anything.
 *   D2 -> AC-003           one capability stops being measured at all, so the count falls from eight
 *                          to seven. Nothing else notices, because the report never claimed it would
 *                          measure eight.
 *   D3 -> AC-009           the permission probe loses its refused half, so the enforcement verdict
 *                          rests on a permitted write alone. **That is exactly the shape this
 *                          repository was caught by once already** - a probe that only attempts the
 *                          refusal cannot tell "the boundary holds" from "every write fails" - and
 *                          here it is injected deliberately so a reader can watch the contract
 *                          refuse it.
 *
 * **D1 reaches two criteria and this table originally claimed one.** The first draft of this comment
 * said "three defects, three criteria, one each", reasoned from each defect's name - and the run
 * disagreed. `survey` derives its own exit code from the audit, so emptying one evidence field makes
 * `absenceIsDistinguishable` false, exits 4, and AC-002's assertion that the survey exits 0 fails
 * beside AC-008's. Nothing arranged that; it is what a shared surface does. The measured descent is
 * therefore **4 -> 2 -> 1 -> 0**, not the 3 -> 2 -> 1 -> 0 the first narration printed.
 *
 * This is the rule `local-process` wrote down after paying for it, applied here rather than recited:
 * **a reach table is a claim about every expectation in the contract, so it has to be read off a run
 * rather than reasoned from the defect's name** - and the count is the part a reader checks first,
 * which is why it is the part that was wrong. D2 and D3 are single-reach controls; D1 is the
 * headline. A table whose every entry moved several criteria would have no control in it, and a demo
 * with no control cannot show that its readings were caused by the edit rather than by the world
 * being flaky.
 *
 * ## What no defect here may touch
 *
 * The readiness line. `local-process` paid for this rule: a defect that misspelt the readiness word
 * took the *world* down, so the run ended `INCONCLUSIVE` at exit 2 before any criterion was observed
 * and before the repair gate was reached - and a defect that takes down the world cannot be repaired
 * by a loop that only starts once the world is up. `environment.yaml`'s `readyPattern` waits for
 * `environment-twin daemon ready`, and none of the three edits below goes near it.
 */

import type { Defect, DefectStatus, InjectResult, RepairResult } from "../defect-text.ts";
import { defectStates, injectDefects, repairDefect } from "../defect-text.ts";

/** The program these defects overlay. Named once so every function agrees about which file it edits. */
const PROGRAM = "app/capability-probe.mjs";

export const DEFECTS: readonly Defect[] = [
  {
    id: "D1",
    criterionId: "AC-008",
    summary:
      "a capability carries no evidence, so the report can no longer show that an absence means anything",
    // The evidence field is what makes an `absent` reading a statement about the machine rather than
    // about the probe. Emptied, the capability is still named and still carries a status - which is
    // precisely why this defect is dangerous and why the audit exists to catch it.
    correct: `  capabilities.push({
    name: "tool.git",
    status: git.ok ? AVAILABLE : ABSENT,
    evidence: git.evidence,
    control: control().status,
  });`,
    defective: `  capabilities.push({
    name: "tool.git",
    status: git.ok ? AVAILABLE : ABSENT,
    evidence: "",
    control: control().status,
  });`,
  },
  {
    id: "D2",
    criterionId: "AC-003",
    summary: "one capability stops being measured, so the report enumerates seven rather than eight",
    // The two blocks deliberately do **not** share a prefix: the first version of this defect deleted
    // the push, which made its defective form a prefix of its correct form, and `defect-text.ts` reads
    // that as `unknown` - because both forms then occur exactly once and neither can be told from the
    // other. Writing the replacement as a distinct comment plus an explicit `void` makes the two forms
    // disjoint, and the `void` is not decoration: `container` is still read above, and a bare comment
    // would leave the binding unused.
    correct: `  capabilities.push({
    name: "container.runtime",
    status: container.ok ? AVAILABLE : ABSENT,
    evidence: container.evidence,
    control: control().status,
  });`,
    defective: `  // D2: the container runtime is deliberately not measured in this program.
  void container;`,
  },
  {
    id: "D3",
    criterionId: "AC-009",
    summary:
      "the permission probe loses its refused half, so an enforcement verdict rests on a permitted write alone",
    // The replacement evidence deliberately says "the permitted half was attempted" and never says
    // what became of the half that was not. That wording is not incidental: it keeps the defect
    // honest about *what it did*, and it means the criterion fails on the half that is genuinely
    // missing rather than on a phrase the defect happened to include.
    correct: `  capabilities.push({
    name: "runtime.permission",
    ...twoStage({
      permitted: () => acceptsRuntimeArgs(["--permission", ...allowance, "-e", allowedWrite]),
      refused: () => {
        const attempt = acceptsRuntimeArgs(["--permission", ...allowance, "-e", refusedWrite]);
        return {
          refused: !attempt.ok,
          evidence: attempt.evidence,
        };
      },
    }),`,
    defective: `  capabilities.push({
    name: "runtime.permission",
    status: acceptsRuntimeArgs(["--permission", ...allowance, "-e", allowedWrite]).ok ? AVAILABLE : ABSENT,
    evidence: "the permitted half was attempted; the boundary was not put to the test",`,
  },
];

export function status(text: string): readonly DefectStatus[] {
  return defectStates(DEFECTS, text);
}

export function inject(text: string): InjectResult {
  return injectDefects(DEFECTS, PROGRAM, text);
}

export function repairOne(text: string): RepairResult {
  return repairDefect(DEFECTS, PROGRAM, text);
}
