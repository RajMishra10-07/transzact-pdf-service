import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TemplateEngine } from '../../templates/engine.js';
import { pdfService } from '../../services/pdf-service.js';
import { asyncHandler } from '../../utils/async-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const previewRouter = Router();

function getSampleData(fileName: string): Record<string, unknown> {
  const samplePath = path.resolve(process.cwd(), 'data', 'samples', fileName);
  const raw = fs.readFileSync(samplePath, 'utf8');
  return JSON.parse(raw);
}

// 1. Interactive Dashboard Playground at root '/'
previewRouter.get('/', (req: Request, res: Response) => {
  const publicIndex = path.resolve(process.cwd(), 'public', 'index.html');
  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TranZact PDF Microservice - Live Playground</title>
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --bg: #f8fafc;
      --card: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
    h1 { font-size: 22px; font-weight: 700; color: #1e293b; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; background: #dcfce7; color: #15803d; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
    .controls { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; }
    button { background: var(--primary); color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.15s; }
    button:hover { background: var(--primary-hover); transform: translateY(-1px); }
    button.secondary { background: #f1f5f9; color: #334155; border: 1px solid var(--border); }
    button.secondary:hover { background: #e2e8f0; }
    .preview-frame { width: 100%; height: 820px; border: 1px solid var(--border); border-radius: 8px; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .links-bar { margin-top: 16px; font-size: 13px; color: var(--text-muted); display: flex; gap: 16px; }
    .links-bar a { color: var(--primary); text-decoration: none; font-weight: 500; }
    .links-bar a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>📄 TranZact PDF Microservice - Live Browser Playground</h1>
        <p style="color: var(--text-muted); font-size: 13px; margin-top: 4px;">Render, preview, and download GST Invoices & Purchase Orders directly in your browser.</p>
      </div>
      <div class="status-badge">
        <span class="status-dot"></span> Service Running (Port 4000)
      </div>
    </header>

    <div class="controls">
      <button onclick="setPreview('/preview/invoice')">📑 Invoice (HTML Template)</button>
      <button onclick="setPreview('/preview/invoice/pdf')">📄 Invoice (Render Real Chromium PDF)</button>
      <button class="secondary" onclick="setPreview('/preview/purchase-order')">📦 Purchase Order (HTML Template)</button>
      <button class="secondary" onclick="setPreview('/preview/purchase-order/pdf')">📄 Purchase Order (Render Real Chromium PDF)</button>
      <button class="secondary" onclick="window.open('/preview/invoice', '_blank')">↗️ Open in New Tab</button>
    </div>

    <iframe id="preview-frame" class="preview-frame" src="/preview/invoice"></iframe>

    <div class="links-bar">
      <span>API Observability:</span>
      <a href="/health" target="_blank">/health</a>
      <a href="/metrics" target="_blank">/metrics</a>
      <a href="/ready" target="_blank">/ready</a>
    </div>
  </div>

  <script>
    function setPreview(url) {
      document.getElementById('preview-frame').src = url;
    }
  </script>
</body>
</html>`);
});

// 2. HTML Preview for GST Invoice
previewRouter.get('/preview/invoice', (req: Request, res: Response) => {
  const sample = getSampleData('sample_invoice.json');
  const html = TemplateEngine.render('invoice', sample.data as Record<string, unknown>);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 3. HTML Preview for Purchase Order
previewRouter.get('/preview/purchase-order', (req: Request, res: Response) => {
  const sample = getSampleData('sample_po.json');
  const html = TemplateEngine.render('purchase_order', sample.data as Record<string, unknown>);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// 4. Real Chromium PDF Inline Streaming for Invoice
previewRouter.get(
  '/preview/invoice/pdf',
  asyncHandler(async (req: Request, res: Response) => {
    const sample = getSampleData('sample_invoice.json');
    const result = await pdfService.renderPdf('invoice', sample.data as Record<string, unknown>);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="invoice_preview.pdf"');
    res.setHeader('Content-Length', result.pdfBuffer.length);
    res.end(result.pdfBuffer);
  })
);

// 5. Real Chromium PDF Inline Streaming for Purchase Order
previewRouter.get(
  '/preview/purchase-order/pdf',
  asyncHandler(async (req: Request, res: Response) => {
    const sample = getSampleData('sample_po.json');
    const result = await pdfService.renderPdf('purchase_order', sample.data as Record<string, unknown>);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="purchase_order_preview.pdf"');
    res.setHeader('Content-Length', result.pdfBuffer.length);
    res.end(result.pdfBuffer);
  })
);

