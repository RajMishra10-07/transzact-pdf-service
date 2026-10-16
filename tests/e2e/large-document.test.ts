import { describe, it, expect, afterAll } from 'vitest';
import { pdfService } from '../../src/services/pdf-service.js';
import { LargeDocumentMemoryError, RenderingTimeoutError } from '../../src/domain/errors.js';

describe('10 & 11. Large Document Memory Safety and Error Handling', () => {
  afterAll(async () => {
    await pdfService.closeBrowser();
  });

  it('11. Should successfully render a document containing 500 line items without crashing', async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      description: `Precision Machined Part Serial #${1000 + i}`,
      hsnSacCode: '8483',
      quantity: 5,
      unit: 'PCS',
      unitPrice: 100,
      taxableAmount: 500,
      cgstRate: 9,
      cgstAmount: 45,
      sgstRate: 9,
      sgstAmount: 45,
      totalAmount: 590,
    }));

    const largeInvoiceData = {
      invoiceNumber: 'INV-500-ITEMS-SAFE',
      invoiceDate: '2026-10-16',
      supplier: {
        name: 'Bulk Industrial Parts Co',
        addressLine1: 'Road 5, Industrial Area',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600001',
      },
      customer: {
        name: 'Automotive Assemblers Ltd',
        addressLine1: 'Auto Hub',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600028',
      },
      items,
      subtotal: 250000,
      totalCgst: 22500,
      totalSgst: 22500,
      grandTotal: 295000,
    };

    const result = await pdfService.renderPdf('invoice', largeInvoiceData);
    expect(result.pdfBuffer).toBeDefined();
    expect(result.pdfBuffer.length).toBeGreaterThan(50000); // 500 items produces multiple pages > 50KB
  }, 40000);

  it('11b. Should gracefully reject documents exceeding maximum safe threshold (> 800 items) with LargeDocumentMemoryError', async () => {
    const excessiveItems = Array.from({ length: 850 }, (_, i) => ({
      description: `Item #${i}`,
      quantity: 1,
      unit: 'PCS',
      unitPrice: 10,
      taxableAmount: 10,
      totalAmount: 10,
    }));

    const unsafePayload = {
      invoiceNumber: 'INV-EXCESSIVE-850',
      invoiceDate: '2026-10-16',
      supplier: {
        name: 'Supplier',
        addressLine1: 'Road 1',
        city: 'City',
        state: 'State',
        pincode: '123456',
      },
      customer: {
        name: 'Customer',
        addressLine1: 'Road 2',
        city: 'City',
        state: 'State',
        pincode: '123456',
      },
      items: excessiveItems,
      subtotal: 8500,
      grandTotal: 8500,
    };

    await expect(
      pdfService.renderPdf('invoice', unsafePayload)
    ).rejects.toThrow(LargeDocumentMemoryError);
  });
});
