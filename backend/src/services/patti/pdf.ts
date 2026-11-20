import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import type { Logger } from '../../config/logger.ts';

/**
 * HTML → PDF via a headless Chromium-family browser (real text shaping for Devanagari conjuncts/matras).
 * No browser is downloaded: PDF_BROWSER_PATH, or the first installed Chrome/Edge/Chromium found.
 * Production image: install `chromium` + `fonts-noto-core` (Devanagari) and set PDF_BROWSER_PATH.
 */
const CANDIDATES = [
  process.env.PDF_BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((p): p is string => !!p);

export class PdfRenderer {
  private browser: Promise<Browser> | null = null;
  readonly executablePath = CANDIDATES.find((p) => existsSync(p)) ?? null;

  constructor(private readonly logger: Logger) {}

  get available(): boolean {
    return this.executablePath !== null;
  }

  private launch(): Promise<Browser> {
    this.browser ??= chromium
      .launch({ executablePath: this.executablePath!, headless: true, args: ['--disable-gpu', '--no-sandbox'] })
      .then((b) => {
        b.on('disconnected', () => (this.browser = null));
        return b;
      })
      .catch((err: unknown) => {
        this.browser = null;
        throw err;
      });
    return this.browser;
  }

  async render(html: string): Promise<Buffer> {
    if (!this.executablePath) throw new Error('No PDF browser available');
    const browser = await this.launch();
    const ctx = await browser.newContext({ javaScriptEnabled: false }); // template is static; no scripts in PDFs
    try {
      const page = await ctx.newPage();
      // Offline: block every network request — the template is fully self-contained.
      await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    } finally {
      await ctx.close().catch((e: unknown) => this.logger.warn({ err: e }, 'pdf context close failed'));
    }
  }

  async close() {
    const b = await this.browser?.catch(() => null);
    await b?.close();
  }
}
