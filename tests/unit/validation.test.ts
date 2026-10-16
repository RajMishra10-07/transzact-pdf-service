import { describe, it, expect } from 'vitest';
import { generateDocumentSchema } from '../../src/api/schemas/document-schemas.js';
import { bulkRequestSchema } from '../../src/api/schemas/bulk-schemas.js';

describe('Request Validation Schemas (Zod)', () => {
  const validInvoicePayload = {
    documentType: 'invoice',
    documentId: 'INV-2026-001',
    tenantId: 'tenant-acme',
    data: {
      invoiceNumber: 'INV-2026-001',
      invoiceDate: '2026-10-15',
      supplier: {
        name: 'Acme Corp Supplies',
        addressLine1: '12 Industrial Area',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
        gstin: '27AAAAA0000A1Z5',
      },
      customer: {
        name: 'Beta Global Tech',
        addressLine1: '45 Tech Park',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        gstin: '29BBBBB1111B2Z6',
      },
      currency: 'INR',
      items: [
        {
          description: 'Industrial Sensor Module',
          hsnSacCode: '8542',
          quantity: 10,
          unit: 'PCS',
          unitPrice: 1500,
          taxableAmount: 15000,
          cgstRate: 9,
          cgstAmount: 1350,
          sgstRate: 9,
          sgstAmount: 1350,
          totalAmount: 17700,
        },
      ],
      subtotal: 15000,
      totalCgst: 1350,
      totalSgst: 1350,
      grandTotal: 17700,
      grandTotalInWords: 'Seventeen Thousand Seven Hundred Rupees Only',
    },
  };

  const validPoPayload = {
    documentType: 'purchase_order',
    documentId: 'PO-2026-089',
    tenantId: 'tenant-acme',
    data: {
      poNumber: 'PO-2026-089',
      poDate: '2026-10-15',
      buyer: {
        name: 'Acme Manufacturing',
        addressLine1: 'Unit 4, Sector 5',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      },
      vendor: {
        name: 'Raw Materials Ltd',
        addressLine1: '89 Ore Lane',
        city: 'Nagpur',
        state: 'Maharashtra',
        pincode: '440001',
      },
      shippingAddress: {
        name: 'Acme Central Warehouse',
        addressLine1: 'Plot 10, Logistics Hub',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411028',
      },
      billingAddress: {
        name: 'Acme Manufacturing',
        addressLine1: 'Unit 4, Sector 5',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      },
      currency: 'INR',
      items: [
        {
          description: 'High Tensile Steel Rods',
          quantity: 50,
          unit: 'KGS',
          unitPrice: 250,
          taxableAmount: 12500,
          totalAmount: 14750,
        },
      ],
      subtotal: 12500,
      totalTax: 2250,
      grandTotal: 14750,
    },
  };

  it('1. should accept a valid invoice request', () => {
    const parsed = generateDocumentSchema.safeParse(validInvoicePayload);
    expect(parsed.success).toBe(true);
  });

  it('2. should accept a valid purchase order request', () => {
    const parsed = generateDocumentSchema.safeParse(validPoPayload);
    expect(parsed.success).toBe(true);
  });

  it('3. should reject an invalid document type', () => {
    const invalidPayload = {
      ...validInvoicePayload,
      documentType: 'bank_statement', // Invalid
    };
    const parsed = generateDocumentSchema.safeParse(invalidPayload);
    expect(parsed.success).toBe(false);
  });

  it('4. should reject missing required fields (e.g. missing items array)', () => {
    const missingItems = {
      ...validInvoicePayload,
      data: {
        ...validInvoicePayload.data,
        items: [], // Empty items
      },
    };
    const parsed = generateDocumentSchema.safeParse(missingItems);
    expect(parsed.success).toBe(false);
  });

  it('4b. should reject missing supplier address fields', () => {
    const missingSupplier = {
      ...validInvoicePayload,
      data: {
        ...validInvoicePayload.data,
        supplier: {
          name: 'Acme',
          // Missing addressLine1, city, state, pincode
        },
      },
    };
    const parsed = generateDocumentSchema.safeParse(missingSupplier);
    expect(parsed.success).toBe(false);
  });

  it('5. should reject bulk request containing more than 100 documents', () => {
    const documents = Array.from({ length: 101 }, (_, i) => ({
      ...validInvoicePayload,
      documentId: `INV-BATCH-${i}`,
    }));

    const parsed = bulkRequestSchema.safeParse({
      tenantId: 'tenant-acme',
      documents,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain('cannot exceed 100 documents');
    }
  });

  it('5b. should reject bulk request with 0 documents', () => {
    const parsed = bulkRequestSchema.safeParse({
      tenantId: 'tenant-acme',
      documents: [],
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain('at least 1 document');
    }
  });
});
