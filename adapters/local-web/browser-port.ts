/**
 * The browser seam.
 *
 * The adapter's job is to drive a browser; the seam is the browser. Everything Playwright-specific
 * sits behind this interface so that `LocalWebEnvironment` — process spawn, readiness, reset,
 * evidence capture and all — can be proven offline against a fake, and so that swapping Playwright
 * for something else later is a new implementation of *this* file rather than a change to the
 * adapter's logic.
 *
 * Two deliberate reductions relative to a real browser API:
 *
 * - **One page, not a tree.** Everything here addresses a single current page. A port that exposed
 *   contexts and pages separately would push the decision of when a criterion gets a clean page up
 *   into the adapter's executor, which is exactly where it *is* decided today — one isolated context
 *   per criterion, so criteria cannot inherit each other's cookies, storage or DOM. Keeping that
 *   decision in one place is what makes it reviewable.
 * - **`read` takes all the selectors at once.** A criterion asks about several targets and the answer
 *   must describe one instant. Reading them one at a time lets the page change between questions and
 *   produces an observation of a world that never existed.
 */

import type { BoundaryPolicy } from "../../core/environment/types.ts";

export interface BrowserLaunchOptions {
  readonly viewport: { readonly width: number; readonly height: number } | null;
  readonly locale: string | null;
  readonly timezoneId: string | null;
  /**
   * The resolved boundary the browser is expected to hold.
   *
   * The whole policy rather than its network half, because the adapter's plan is the one thing that
   * describes the world it runs in, and narrowing it here would mean re-deriving the policy at the
   * seam - a second reader, which is how two readings of one fact start to differ. The browser reads
   * `network` and `allow` and ignores the rest.
   */
  readonly boundary: BoundaryPolicy;
  /**
   * The origin of the application under test, which every policy permits.
   *
   * A boundary exists to keep the application away from the outside world, not away from itself, so
   * the application's own origin is the one host `deny` cannot block without blocking the run. The
   * adapter supplies it because the adapter is what read the plan; the browser compares against it.
   */
  readonly appOrigin: string;
}

/**
 * One request the boundary refused.
 *
 * A fact, not a verdict. Whether a refusal is a violation depends on the policy that produced it,
 * which is the core's business - the page knows only what it did.
 */
export interface BrowserRefusal {
  /** `GET https://example.test/v1/ping` — the method and URL the guard acted on. */
  readonly subject: string;
  readonly at: string;
}

/** What the adapter asked for and what the page reported. */
export interface RawTarget {
  readonly found: boolean;
  readonly count: number;
  readonly text: string | null;
  readonly value: string | null;
  readonly visible: boolean;
  readonly error: string | null;
}

export interface BrowserConsoleEntry {
  readonly level: string;
  readonly text: string;
  readonly at: string;
}

export interface BrowserNetworkEntry {
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly at: string;
}

export interface BrowserPage {
  goto(url: string, timeoutMs: number): Promise<void>;
  reload(timeoutMs: number): Promise<void>;
  click(selector: string, timeoutMs: number): Promise<void>;
  fill(selector: string, value: string, timeoutMs: number): Promise<void>;
  select(selector: string, value: string, timeoutMs: number): Promise<void>;
  press(selector: string, key: string, timeoutMs: number): Promise<void>;
  waitFor(selector: string, state: string, timeoutMs: number): Promise<void>;
  /** One instant, all selectors. Never throws for a selector that matched nothing. */
  read(selectors: readonly string[]): Promise<Readonly<Record<string, RawTarget>>>;
  url(): string;
  title(): Promise<string | null>;
  /** The serialised DOM, for the `dom` evidence kind. */
  content(): Promise<string>;
  screenshot(): Promise<Uint8Array>;
  consoleEntries(): readonly BrowserConsoleEntry[];
  networkEntries(): readonly BrowserNetworkEntry[];
  /**
   * Everything the boundary refused while this page lived, in order.
   *
   * Empty is ambiguous on its own - it means either "nothing was refused" or "no guard was
   * installed" - which is why the adapter pairs it with the enforcement status it reports from
   * `boundaries()`. Reading an empty list as a clean page without that pairing is exactly the
   * mistake the boundary report exists to prevent.
   */
  refusals(): readonly BrowserRefusal[];
  /**
   * Flush the trace to its path (when one was requested) and dispose the page's context.
   *
   * Never rejects: it runs on the failure path as well as the success path, and a browser that
   * cannot be tidied up must not replace the finding the run was about to report.
   */
  close(): Promise<void>;
}

/**
 * A launched browser.
 *
 * `newPage` mints a *fresh isolated context* per call rather than a tab, so nothing a criterion does
 * — a cookie, a `localStorage` key, a mutated DOM — can reach the next criterion. That is the
 * criterion-level counterpart of "a validator must never inherit contaminated state from a previous
 * run", and it is part of why M1 (repeat consistency) can hold at all.
 */
export interface BrowserSession {
  readonly kind: string;
  /** `tracePath` is an absolute path, or `null` to record no trace for this page. */
  newPage(tracePath: string | null): Promise<BrowserPage>;
  close(): Promise<void>;
}

export interface BrowserPort {
  readonly kind: string;
  /** Rejects with a message that names the cause when the browser cannot start. */
  launch(options: BrowserLaunchOptions): Promise<BrowserSession>;
}

/**
 * The launch failure that means "Playwright is not installed".
 *
 * Exported as a named constant because the CLI has to recognise it to print the one instruction that
 * fixes it (`npm run e2e:install`), and a substring match on a message spelled out in three places
 * would rot the first time one of them is reworded.
 */
export const PLAYWRIGHT_MISSING =
  "Playwright is not installed. The web sandbox cannot drive a browser without it. " +
  "Run `npm run e2e:install` once (about 150 MB), or point the environment at a different adapter.";
