import { describe, it, expect, afterAll } from 'vitest';
import { pdfService } from '../../src/services/pdf-service.js';
import { computeBufferHash } from '../../src/utils/hash.js';

describe('9. End-to-End Real Puppeteer PDF Generation', () => {
  afterAll(async () => {
    await pdfService.closeBrowser();
  });

  it('should render a valid GST Invoice PDF using real Chromium', async () => {
    const invoiceData = {
      invoiceNumber: 'INV-E2E-2026-001',
      invoiceDate: '2026-10-16',
      dueDate: '2026-11-16',
      supplier: {
        name: 'Apex Industrial Solutions Pvt Ltd',
        addressLine1: 'Plot 45, Phase II, Hinjewadi',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411057',
        gstin: '27AABCA1234F1Z6',
        pan: 'AABCA1234F',
        contactEmail: 'billing@apexsolutions.in',
      },
      customer: {
        name: 'Omni Retailers India Ltd',
        addressLine1: 'Building 7, Cyber City',
        city: 'Gurugram',
        state: 'Haryana',
        pincode: '122002',
        gstin: '06BBBCB5678G2Z8',
      },
      placeOfSupply: 'Haryana (06)',
      currency: 'INR',
      items: [
        {
          description: 'High Performance Precision Bearing',
          hsnSacCode: '8482',
          quantity: 25,
          unit: 'PCS',
          unitPrice: 1200,
          taxableAmount: 30000,
          igstRate: 18,
          igstAmount: 5400,
          totalAmount: 35400,
        },
        {
          description: 'Synthetic Lubricant Grade ISO 68 (20L Drum)',
          hsnSacCode: '2710',
          quantity: 2,
          unit: 'DRUM',
          unitPrice: 8500,
          taxableAmount: 17000,
          igstRate: 18,
          igstAmount: 3060,
          totalAmount: 20060,
        },
      ],
      subtotal: 47000,
      totalIgst: 8460,
      grandTotal: 55460,
      grandTotalInWords: 'Fifty Five Thousand Four Hundred Sixty Rupees Only',
      bankDetails: {
        bankName: 'HDFC Bank',
        accountNumber: '50200012345678',
        ifscCode: 'HDFC0000123',
        branchName: 'Hinjewadi Pune',
      },
      termsAndConditions: '1. Payment due within 30 days.\n2. Goods once sold will not be taken back.',
    };

    const result = await pdfService.renderPdf('invoice', invoiceData);

    expect(result.pdfBuffer).toBeDefined();
    expect(result.pdfBuffer.length).toBeGreaterThan(10000); // Greater than 10 KB
    expect(result.renderDurationMs).toBeGreaterThan(0);
    expect(result.templateVersion).toBe('1.0.0');

    // Verify PDF header magic bytes "%PDF-"
    const pdfHeader = result.pdfBuffer.subarray(0, 5).toString('utf8');
    expect(pdfHeader).toBe('%PDF-');

    // Verify SHA-256 computation over exact bytes
    const checksum = computeBufferHash(result.pdfBuffer);
    expect(checksum).toHaveLength(64);
  }, 25000);

  it('should render a valid Purchase Order PDF using real Chromium', async () => {
    const poData = {
      poNumber: 'PO-E2E-2026-999',
      poDate: '2026-10-16',
      deliveryDate: '2026-10-25',
      buyer: {
        name: 'TranZact Manufacturing Technologies',
        addressLine1: 'Tech Park, Andheri East',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400069',
        gstin: '27ZZZZZ9999Z1Z1',
      },
      vendor: {
        name: 'Precision Metal Works',
        addressLine1: 'MIDC Industrial Estate',
        city: 'Nashik',
        state: 'Maharashtra',
        pincode: '422010',
        gstin: '27YYYYY8888Y2Y2',
      },
      shippingAddress: {
        name: 'TranZact Central Warehouse',
        addressLine1: 'Bhiwandi Logistics Hub',
        city: 'Thane',
        state: 'Maharashtra',
        pincode: '421302',
      },
      billingAddress: {
        name: 'TranZact Manufacturing Technologies',
        addressLine1: 'Tech Park, Andheri East',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400069',
      },
      currency: 'INR',
      items: [
        {
          description: 'CNC Milled Aluminum Plate 200x300mm',
          hsnSacCode: '7606',
          quantity: 100,
          unit: 'PCS',
          unitPrice: 450,
          taxableAmount: 45000,
          totalAmount: 53100,
        },
      ],
      subtotal: 45000,
      totalTax: 8100,
      grandTotal: 53100,
      paymentTerms: 'Net 45 Days from delivery date',
      deliveryTerms: 'FOB Destination',
    };

    const result = await pdfService.renderPdf('purchase_order', poData);

    expect(result.pdfBuffer).toBeDefined();
    expect(result.pdfBuffer.length).toBeGreaterThan(10000);
    const pdfHeader = result.pdfBuffer.subarray(0, 5).toString('utf8');
    expect(pdfHeader).toBe('%PDF-');
  }, 25000);
});
