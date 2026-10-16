import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DocumentType } from '../domain/document.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register Handlebars helpers for deterministic formatting
Handlebars.registerHelper('formatCurrency', function (amount: number, currency = 'INR') {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return '0.00';
  }
  // Deterministic format: 2 decimal places with comma separation
  const parts = amount.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = currency === 'INR' ? '₹' : currency;
  return `${symbol} ${parts.join('.')}`;
});

Handlebars.registerHelper('formatDate', function (dateStr: string) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
});

Handlebars.registerHelper('addOne', function (index: number) {
  return index + 1;
});

Handlebars.registerHelper('eq', function (a: unknown, b: unknown) {
  return a === b;
});

export class TemplateEngine {
  private static compiledTemplates: Map<string, HandlebarsTemplateDelegate> = new Map();
  private static templateStyles: Map<string, string> = new Map();

  public static initialize(): void {
    const templatesDir = __dirname;

    // Load Invoice Template
    const invoiceHtmlPath = path.join(templatesDir, 'invoice', 'invoice.html');
    const invoiceCssPath = path.join(templatesDir, 'invoice', 'invoice.css');
    if (fs.existsSync(invoiceHtmlPath) && fs.existsSync(invoiceCssPath)) {
      const invoiceHtml = fs.readFileSync(invoiceHtmlPath, 'utf8');
      const invoiceCss = fs.readFileSync(invoiceCssPath, 'utf8');
      this.compiledTemplates.set('invoice', Handlebars.compile(invoiceHtml));
      this.templateStyles.set('invoice', invoiceCss);
    }

    // Load Purchase Order Template
    const poHtmlPath = path.join(templatesDir, 'purchase-order', 'purchase-order.html');
    const poCssPath = path.join(templatesDir, 'purchase-order', 'purchase-order.css');
    if (fs.existsSync(poHtmlPath) && fs.existsSync(poCssPath)) {
      const poHtml = fs.readFileSync(poHtmlPath, 'utf8');
      const poCss = fs.readFileSync(poCssPath, 'utf8');
      this.compiledTemplates.set('purchase_order', Handlebars.compile(poHtml));
      this.templateStyles.set('purchase_order', poCss);
    }
  }

  public static render(documentType: DocumentType, data: Record<string, unknown>): string {
    const compiled = this.compiledTemplates.get(documentType);
    const css = this.templateStyles.get(documentType) || '';

    if (!compiled) {
      this.initialize();
      const retryCompiled = this.compiledTemplates.get(documentType);
      if (!retryCompiled) {
        throw new Error(`Template not found for document type: ${documentType}`);
      }
      return retryCompiled({ ...data, inlineCss: css, templateVersion: '1.0.0' });
    }

    return compiled({ ...data, inlineCss: css, templateVersion: '1.0.0' });
  }

  public static getTemplateVersion(documentType: DocumentType): string {
    return '1.0.0';
  }
}
