/**
 * The local-web adapter family.
 *
 * A barrel with three jobs: hand out the environment adapter, hand out the browser implementation it
 * uses, and hand out the *seam* — so a test can substitute a fake browser without reaching into a
 * sibling file, and so the one message the CLI has to recognise travels with the thing that raises it.
 */

export { PLAYWRIGHT_MISSING } from "./browser-port.ts";
export type {
  BrowserConsoleEntry,
  BrowserLaunchOptions,
  BrowserNetworkEntry,
  BrowserPage,
  BrowserPort,
  BrowserSession,
  RawTarget,
} from "./browser-port.ts";

export { LocalWebEnvironment } from "./local-web-environment.ts";
export type { FetchLike, HttpResponseLike, LocalWebEnvironmentOptions } from "./local-web-environment.ts";

export { playwrightBrowser } from "./playwright-browser.ts";
export type { PlaywrightBrowserOptions } from "./playwright-browser.ts";
