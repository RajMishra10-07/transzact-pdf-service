import { z } from 'zod';

export const addressSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  addressLine1: z.string().min(1, 'Address line 1 is required').max(255),
  addressLine2: z.string().max(255).optional(),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().min(1, 'State is required').max(100),
  pincode: z.string().min(3).max(20),
  country: z.string().max(100).default('India'),
  gstin: z.string().max(20).optional(),
  pan: z.string().max(20).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(30).optional(),
});

export const lineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, 'Description is required').max(500),
  hsnSacCode: z.string().max(20).optional(),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unit: z.string().min(1).max(20).default('PCS'),
  unitPrice: z.number().nonnegative('Unit price cannot be negative'),
  discountAmount: z.number().nonnegative().optional().default(0),
  taxableAmount: z.number().nonnegative('Taxable amount cannot be negative'),
  cgstRate: z.number().nonnegative().optional(),
  cgstAmount: z.number().nonnegative().optional(),
  sgstRate: z.number().nonnegative().optional(),
  sgstAmount: z.number().nonnegative().optional(),
  igstRate: z.number().nonnegative().optional(),
  igstAmount: z.number().nonnegative().optional(),
  totalAmount: z.number().nonnegative('Total amount cannot be negative'),
});

export const invoiceDataSchema = z.object({
  invoiceNumber: z.string().min(1, 'Invoice number is required').max(100),
  invoiceDate: z.string().min(1, 'Invoice date is required').max(30),
  dueDate: z.string().max(30).optional(),
  supplier: addressSchema,
  customer: addressSchema,
  placeOfSupply: z.string().max(100).optional(),
  reverseCharge: z.boolean().optional().default(false),
  currency: z.string().max(10).default('INR'),
  items: z.array(lineItemSchema).min(1, 'At least one line item is required'),
  subtotal: z.number().nonnegative(),
  totalDiscount: z.number().nonnegative().optional().default(0),
  totalCgst: z.number().nonnegative().optional(),
  totalSgst: z.number().nonnegative().optional(),
  totalIgst: z.number().nonnegative().optional(),
  grandTotal: z.number().nonnegative('Grand total cannot be negative'),
  grandTotalInWords: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(2000).optional(),
  bankDetails: z
    .object({
      bankName: z.string().min(1).max(100),
      accountNumber: z.string().min(1).max(50),
      ifscCode: z.string().min(1).max(20),
      branchName: z.string().max(100).optional(),
    })
    .optional(),
});

export const purchaseOrderDataSchema = z.object({
  poNumber: z.string().min(1, 'PO number is required').max(100),
  poDate: z.string().min(1, 'PO date is required').max(30),
  deliveryDate: z.string().max(30).optional(),
  buyer: addressSchema,
  vendor: addressSchema,
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  currency: z.string().max(10).default('INR'),
  items: z.array(lineItemSchema).min(1, 'At least one line item is required'),
  subtotal: z.number().nonnegative(),
  totalTax: z.number().nonnegative(),
  grandTotal: z.number().nonnegative(),
  grandTotalInWords: z.string().max(500).optional(),
  paymentTerms: z.string().max(1000).optional(),
  deliveryTerms: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
});

export const renderOptionsSchema = z.object({
  format: z.enum(['A4', 'Letter']).default('A4').optional(),
  orientation: z.enum(['portrait', 'landscape']).default('portrait').optional(),
  displayHeaderFooter: z.boolean().default(false).optional(),
  preferSync: z.boolean().default(false).optional(),
});

export const generateDocumentSchema = z
  .object({
    documentType: z.enum(['invoice', 'purchase_order']),
    documentId: z.string().min(1).max(100),
    tenantId: z.string().min(1).max(100),
    idempotencyKey: z.string().max(200).optional(),
    data: z.record(z.unknown()),
    options: renderOptionsSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.documentType === 'invoice') {
      const res = invoiceDataSchema.safeParse(val.data);
      if (!res.success) {
        res.error.issues.forEach((issue) => {
          ctx.addIssue({
            ...issue,
            path: ['data', ...issue.path],
          });
        });
      }
    } else if (val.documentType === 'purchase_order') {
      const res = purchaseOrderDataSchema.safeParse(val.data);
      if (!res.success) {
        res.error.issues.forEach((issue) => {
          ctx.addIssue({
            ...issue,
            path: ['data', ...issue.path],
          });
        });
      }
    }
  });

export type GenerateDocumentRequest = z.infer<typeof generateDocumentSchema>;
