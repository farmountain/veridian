/**
 * The Playwright-backed validator family.
 *
 * The directory names the *implementation* that makes these validators decidable — Playwright drives
 * the browser that produced the observations. The validator names are `web.*`, because a criterion
 * is about a web page rather than about the driver, so a later adapter for the same domain reuses
 * this family unchanged.
 */

export { WEB_UI_VALIDATORS, WEB_UI_VALIDATOR_NAMES, webUiValidators } from "./web-ui-validators.ts";
