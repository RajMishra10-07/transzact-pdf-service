import puppeteer, { Browser, Page } from 'puppeteer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { RenderingTimeoutError, LargeDocumentMemoryError } from '../domain/errors.js';
import { DocumentRenderOptions, DocumentType } from '../domain/document.js';
import { TemplateEngine } from '../templates/engine.js';

export interface RenderResult {
  pdfBuffer: Buffer;
  renderDurationMs: number;
  templateVersion: string;
}

export class PdfService {
  private browser: Browser | null = null;
  private rendersCount = 0;
  private isInitializing = false;

  constructor() {
    // Initialize templates on service creation
    TemplateEngine.initialize();
  }

  /**
   * Returns a healthy Chromium browser instance.
   * Recycles the browser process after a configured number of renders to prevent memory leaks.
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) {
      if (this.rendersCount >= env.MAX_BROWSER_LIFETIME_RENDERS) {
        logger.info(
          { rendersCount: this.rendersCount, max: env.MAX_BROWSER_LIFETIME_RENDERS },
          'Recycling Chromium browser process after reaching max lifetime renders'
        );
        await this.closeBrowser();
      } else {
        return this.browser;
      }
    }

    if (this.isInitializing) {
      // Small backoff wait if already initializing
      await new Promise((resolve) => setTimeout(resolve, 150));
      return this.getBrowser();
    }

    this.isInitializing = true;
    try {
      logger.info('Launching new Chromium browser process...');
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // Critical for containers with small /dev/shm
          '--disable-gpu',
          '--no-zygote',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--mute-audio',
          '--no-first-run',
        ],
      });
      this.rendersCount = 0;
      return this.browser;
    } catch (err) {
      logger.error({ err }, 'Failed to launch Chromium browser');
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Renders HTML to a high-quality PDF buffer using Chromium.
   * Enforces strict timeout, request interception (blocks outbound web calls),
   * and guaranteed page cleanup in finally blocks.
   */
  public async renderPdf(
    documentType: DocumentType,
    data: Record<string, unknown>,
    options?: DocumentRenderOptions
  ): Promise<RenderResult> {
    const startTime = Date.now();

    // Check line item complexity threshold for memory safety
    const items = (data.items as unknown[]) || [];
    if (items.length > 800) {
      throw new LargeDocumentMemoryError(
        `Document contains ${items.length} line items, exceeding maximum safe limit of 800 items`
      );
    }

    // Compile HTML from template
    const html = TemplateEngine.render(documentType, data);
    const templateVersion = TemplateEngine.getTemplateVersion(documentType);

    const browser = await this.getBrowser();
    let page: Page | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    try {
      page = await browser.newPage();

      // Explicitly disable JavaScript execution in Chromium to prevent any malicious script execution
      await page.setJavaScriptEnabled(false);

      // Intercept and block unnecessary external network requests to prevent SSRF and memory leaks
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url().toLowerCase();
        // Allow only data URIs and inline content
        if (url.startsWith('data:') || url.startsWith('about:blank')) {
          req.continue();
        } else {
          // Block all outbound web requests
          req.abort();
        }
      });

      // Strict rendering timeout promise race
      const timeoutMs = options?.preferSync ? env.SYNC_RENDER_TIMEOUT_MS : env.RENDER_TIMEOUT_MS;

      const renderPromise = (async () => {
        if (!page) throw new Error('Page not initialized');

        await page.setContent(html, {
          waitUntil: 'load',
          timeout: timeoutMs,
        });

        const pdfUint8Array = await page.pdf({
          format: options?.format || 'A4',
          landscape: options?.orientation === 'landscape',
          printBackground: true,
          displayHeaderFooter: options?.displayHeaderFooter || false,
          headerTemplate: options?.headerTemplate || '<span></span>',
          footerTemplate: options?.footerTemplate || '<span></span>',
          margin: {
            top: '12mm',
            bottom: '15mm',
            left: '10mm',
            right: '10mm',
          },
        });

        return Buffer.from(pdfUint8Array);
      })();

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new RenderingTimeoutError(`Rendering exceeded timeout of ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const pdfBuffer = await Promise.race([renderPromise, timeoutPromise]);
      this.rendersCount++;

      const renderDurationMs = Date.now() - startTime;
      logger.info(
        { documentType, durationMs: renderDurationMs, pdfSizeBytes: pdfBuffer.length, rendersCount: this.rendersCount },
        'PDF rendered successfully'
      );

      return {
        pdfBuffer,
        renderDurationMs,
        templateVersion,
      };
    } catch (err) {
      logger.error({ err, documentType }, 'Error during PDF generation');
      // If error is timeout or browser crash, forcefully close browser so no zombie processes linger
      if (err instanceof RenderingTimeoutError || (err as Error).message.includes('Session closed')) {
        await this.closeBrowser();
      }
      throw err;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (page) {
        try {
          if (!page.isClosed()) {
            await page.close();
          }
        } catch (closeErr) {
          logger.warn({ closeErr }, 'Error closing page');
        }
      }
    }
  }

  public async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        logger.warn({ err }, 'Error closing Chromium browser');
      } finally {
        this.browser = null;
        this.rendersCount = 0;
      }
    }
  }
}

// Export singleton instance
export const pdfService = new PdfService();
