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

export interface BrowserLaunchOptions {
  readonly viewport: { readonly width: number; readonly height: number } | null;
  readonly locale: string | null;
  readonly timezoneId: string | null;
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
