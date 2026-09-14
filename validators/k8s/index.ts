/**
 * The `k8s.*` validator family's front door.
 *
 * Same shape as the other two: the family, its names and a fresh-array accessor, so a registry can
 * own its list without a family exporting a mutable global.
 */

export { K8S_VALIDATORS, K8S_VALIDATOR_NAMES, k8sValidators } from "./k8s-validators.ts";
