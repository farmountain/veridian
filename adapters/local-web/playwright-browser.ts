/**
 * The Playwright implementation of {@link BrowserPort}, loaded lazily.
 *
 * ## Why the import is not a static `import`
 *
 * Playwright is a ~150 MB opt-in dependency (plan §6.2). If this file imported it at the top, every
 * `import` of the adapter barrel — including from `core`'s own test files — would fail to load on a
 * machine that has not run `npm run e2e:install`, and Veridian's offline suite would stop working to
 * support a feature it does not test. The module is therefore resolved inside `launch()`, and its
 * absence is reported as an ordinary classified failure rather than a module-resolution crash.
 *
 * ## Why the API is declared structurally instead of imported as types
 *
 * `import type { Browser } from "playwright"` would need Playwright's types at *compile* time, which
 * re-creates exactly the coupling the lazy import removes — `tsc --noEmit` is part of the gate on a
 * machine that has not installed it. The surface used here is small and stable, so it is declared
 * once, below, and every property is optional at the top level so that a Playwright version that
 * renamed something fails at `launch()` with a named cause rather than at parse time with a stack.
 */

import { EnvironmentError } from "../../core/failure.ts";
import { PLAYWRIGHT_MISSING, type BrowserLaunchOptions, type BrowserPort, type BrowserPage, type BrowserSession, type RawTarget } from "./browser-port.ts";

// --- the slice of the Playwright API this adapter uses -------------------------------------------

interface PwLocator {
  count(): Promise<number>;
  first(): PwLocator;
  textContent(): Promise<string | null>;
  inputValue(): Promise<string>;
  isVisible(): Promise<boolean>;
}

interface PwConsoleMessage {
  type(): string;
  text(): string;
}

interface PwResponse {
  url(): string;
  status(): number;
  request(): { method(): string };
}

interface PwPage {
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
  reload(options: { timeout: number }): Promise<unknown>;
  click(selector: string, options: { timeout: number }): Promise<unknown>;
  fill(selector: string, value: string, options: { timeout: number }): Promise<unknown>;
  selectOption(selector: string, value: string, options: { timeout: number }): Promise<unknown>;
  press(selector: string, key: string, options: { timeout: number }): Promise<unknown>;
  waitForSelector(selector: string, options: { state: string; timeout: number }): Promise<unknown>;
  locator(selector: string): PwLocator;
  url(): string;
  title(): Promise<string>;
  content(): Promise<string>;
  screenshot(): Promise<Uint8Array>;
  on(event: "console", handler: (message: PwConsoleMessage) => void): void;
  on(event: "response", handler: (response: PwResponse) => void): void;
  close(): Promise<void>;
}

interface PwContext {
  newPage(): Promise<PwPage>;
  tracing: {
    start(options: { screenshots: boolean; snapshots: boolean }): Promise<void>;
    stop(options: { path: string }): Promise<void>;
  };
  close(): Promise<void>;
}

interface PwBrowser {
  newContext(options: {
    viewport?: { width: number; height: number };
    locale?: string;
    timezoneId?: string;
  }): Promise<PwContext>;
  close(): Promise<void>;
}

interface PwChromium {
  launch(options: { headless: boolean }): Promise<PwBrowser>;
}

interface PwModule {
  readonly chromium?: PwChromium;
}

/**
 * Resolve the module by name rather than by literal.
 *
 * A literal specifier would be resolved by `tsc` at compile time even inside `await import(...)`, so
 * the gate would demand an optional dependency. This is the smallest possible concession to that, and
 * it is confined to one line whose failure mode is the `PLAYWRIGHT_MISSING` message.
 */
async function loadPlaywright(): Promise<PwChromium> {
  const specifier = "playwright";
  let module: PwModule;
  try {
    module = (await import(specifier)) as PwModule;
  } catch {
    throw new EnvironmentError(PLAYWRIGHT_MISSING);
  }
  const chromium = module.chromium;
  if (chromium === undefined) throw new EnvironmentError(PLAYWRIGHT_MISSING);
  return chromium;
}

const trimmed = (value: string | null): string | null => (value === null ? null : value.trim());

class PlaywrightPage implements BrowserPage {
  readonly #page: PwPage;
  readonly #context: PwContext;
  readonly #consoleEntries: { level: string; text: string; at: string }[] = [];
  readonly #networkEntries: { method: string; url: string; status: number | null; at: string }[] = [];
  readonly #tracePath: string | null;
  #closed = false;

  constructor(page: PwPage, context: PwContext, tracePath: string | null) {
    this.#page = page;
    this.#context = context;
    this.#tracePath = tracePath;

    // Listeners are attached before the first navigation, so a console error emitted during the
    // initial page load is not lost. An evidence kind that silently starts recording only after
    // `goto` would report "no console errors" for exactly the failures that happen first.
    page.on("console", (message) => {
      this.#consoleEntries.push({ level: message.type(), text: message.text(), at: new Date().toISOString() });
    });
    page.on("response", (response) => {
      const status = response.status();
      this.#networkEntries.push({
        method: response.request().method(),
        url: response.url(),
        status,
        at: new Date().toISOString(),
      });
    });
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    await this.#page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  }

  async reload(timeoutMs: number): Promise<void> {
    await this.#page.reload({ timeout: timeoutMs });
  }

  async click(selector: string, timeoutMs: number): Promise<void> {
    await this.#page.click(selector, { timeout: timeoutMs });
  }

  async fill(selector: string, value: string, timeoutMs: number): Promise<void> {
    await this.#page.fill(selector, value, { timeout: timeoutMs });
  }

  async select(selector: string, value: string, timeoutMs: number): Promise<void> {
    await this.#page.selectOption(selector, value, { timeout: timeoutMs });
  }

  async press(selector: string, key: string, timeoutMs: number): Promise<void> {
    await this.#page.press(selector, key, { timeout: timeoutMs });
  }

  async waitFor(selector: string, state: string, timeoutMs: number): Promise<void> {
    await this.#page.waitForSelector(selector, { state, timeout: timeoutMs });
  }

  async read(selectors: readonly string[]): Promise<Readonly<Record<string, RawTarget>>> {
    const result: Record<string, RawTarget> = {};
    for (const selector of selectors) {
      result[selector] = await this.#readOne(selector);
    }
    return result;
  }

  async #readOne(selector: string): Promise<RawTarget> {
    let count: number;
    try {
      count = await this.#page.locator(selector).count();
    } catch (error) {
      // A selector that cannot be evaluated is reported as such, never as "nothing matched". The two
      // lead an external agent to opposite conclusions: one to fix the criterion, the other to fix
      // the application.
      return {
        found: false,
        count: 0,
        text: null,
        value: null,
        visible: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (count === 0) {
      return { found: false, count: 0, text: null, value: null, visible: false, error: null };
    }

    const first = this.#page.locator(selector).first();
    let text: string | null = null;
    let value: string | null = null;
    let visible = false;

    try {
      text = trimmed(await first.textContent());
    } catch {
      // Detached between the count and the read. `text: null` is the honest answer, and it will
      // surface as an INCONCLUSIVE-or-FAIL assertion rather than a fabricated empty string.
      text = null;
    }
    try {
      value = await first.inputValue();
    } catch {
      // Not a form control. `null` distinguishes "has no value" from "value is the empty string",
      // which matters for every `value.equals` criterion ever written.
      value = null;
    }
    try {
      visible = await first.isVisible();
    } catch {
      visible = false;
    }

    return { found: true, count, text, value, visible, error: null };
  }

  url(): string {
    return this.#page.url();
  }

  async title(): Promise<string | null> {
    try {
      return trimmed(await this.#page.title());
    } catch {
      return null;
    }
  }

  async content(): Promise<string> {
    return this.#page.content();
  }

  async screenshot(): Promise<Uint8Array> {
    return this.#page.screenshot();
  }

  consoleEntries(): readonly { level: string; text: string; at: string }[] {
    return [...this.#consoleEntries];
  }

  networkEntries(): readonly { method: string; url: string; status: number | null; at: string }[] {
    return [...this.#networkEntries];
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;

    if (this.#tracePath !== null) {
      try {
        await this.#context.tracing.stop({ path: this.#tracePath });
      } catch {
        // A trace that could not be written is missing evidence, and missing evidence is already a
        // first-class outcome (`missingEvidence` → INCONCLUSIVE). Throwing here would instead lose
        // the observation the run was in the middle of making.
      }
    }
    try {
      await this.#context.close();
    } catch {
      // Context disposal is best effort for the same reason.
    }
  }
}

class PlaywrightSession implements BrowserSession {
  readonly kind = "playwright";
  readonly #browser: PwBrowser;
  readonly #options: BrowserLaunchOptions;
  #closed = false;

  constructor(browser: PwBrowser, options: BrowserLaunchOptions) {
    this.#browser = browser;
    this.#options = options;
  }

  async newPage(tracePath: string | null): Promise<BrowserPage> {
    // The launch options are applied to every context rather than to a single shared one, because
    // isolation is per-criterion: a viewport set once on a reused context would be the only piece of
    // the world that leaked between criteria.
    const context = await this.#browser.newContext({
      ...(this.#options.viewport === null
        ? {}
        : { viewport: { width: this.#options.viewport.width, height: this.#options.viewport.height } }),
      ...(this.#options.locale === null ? {} : { locale: this.#options.locale }),
      ...(this.#options.timezoneId === null ? {} : { timezoneId: this.#options.timezoneId }),
    });
    if (tracePath !== null) {
      await context.tracing.start({ screenshots: true, snapshots: true });
    }
    const page = await context.newPage();
    return new PlaywrightPage(page, context, tracePath);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#browser.close();
    } catch {
      // Best effort. An orphaned browser process would hold memory, not a port, and the run is over.
    }
  }
}

export interface PlaywrightBrowserOptions {
  /** Set false to watch the run happen. Defaults to headless, because a CI run has no screen. */
  readonly headless?: boolean;
}

/**
 * The real browser.
 *
 * `headless` defaults to `true` rather than inheriting Playwright's own default: a run that pops a
 * window on a developer's machine is a run that behaves differently there, and reproducibility is
 * the product.
 */
export function playwrightBrowser(options: PlaywrightBrowserOptions = {}): BrowserPort {
  const headless = options.headless ?? true;

  return {
    kind: "playwright",
    async launch(launchOptions: BrowserLaunchOptions): Promise<BrowserSession> {
      const chromium = await loadPlaywright();
      let browser: PwBrowser;
      try {
        browser = await chromium.launch({ headless });
      } catch (error) {
        // A browser that is installed but cannot start (missing shared libraries, a sandbox refusal,
        // a stale download) is an environment failure, and the message says which.
        throw new EnvironmentError(
          `Playwright is installed but Chromium did not start: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return new PlaywrightSession(browser, launchOptions);
    },
  };
}
