/**
 * The validator families this build can judge with.
 *
 * This lives beside the entry point rather than inside it, for the same reason `cli/worlds.ts` does:
 * `cli/veridian.ts` calls `main()` at module scope, so nothing can import it to *read* a decision it
 * makes. A list of families is a decision, and it is one that has to be held against the directories
 * on disk - because a family implemented under `validators/` and never spread here is a family no run
 * can judge, and nothing else in the tree would notice.
 */

import type { Validator } from "../core/validation/index.ts";
import { webUiValidators } from "../validators/playwright/index.ts";
import { dbValidators } from "../validators/database/index.ts";
import { k8sValidators } from "../validators/k8s/index.ts";
import { posixValidators } from "../validators/posix/index.ts";
import { osValidators } from "../validators/os/index.ts";
import { cloudValidators } from "../validators/cloud/index.ts";
import { containerValidators } from "../validators/container/index.ts";
import { vscodeValidators } from "../validators/vscode/index.ts";
import { apiValidators } from "../validators/api/index.ts";
import { processValidators } from "../validators/process/index.ts";
import { dataValidators } from "../validators/data/index.ts";
import { mobileValidators } from "../validators/mobile/index.ts";

/**
 * Every validator this build can judge with.
 *
 * Every family, because the registry is what decides whether a criterion is *answerable* and
 * the answer must not depend on which world the run chose. A contract that names `web.element`,
 * `db.value`, `k8s.ready`, `posix.permission`, `os.access`, `cloud.object`, `container.state`,
 * `vscode.command`, `api.status`, `process.exitcode`, `data.record` or `mobile.bundle` is judged by
 * the world that can observe it and refused with `unresolvable_entity` everywhere else - by the plan
 * decoder, at DEFINE, before anything starts. Registering a family only when a world that can answer
 * it was selected would make the *same contract* resolvable in one world and nonsensical in another,
 * and the resolvability of a criterion is a property of the criterion.
 */
export function allValidators(): Validator[] {
  return [
    ...webUiValidators(),
    ...dbValidators(),
    ...k8sValidators(),
    ...posixValidators(),
    ...osValidators(),
    ...cloudValidators(),
    ...containerValidators(),
    ...vscodeValidators(),
    ...apiValidators(),
    ...processValidators(),
    ...dataValidators(),
    ...mobileValidators(),
  ];
}
