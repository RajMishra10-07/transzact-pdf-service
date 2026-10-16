import { BulkJobStatus, GenerationJobStatus } from './job-state.js';

export type DocumentType = 'invoice' | 'purchase_order';

export interface LineItem {
  id?: string;
  description: string;
  hsnSacCode?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountAmount?: number;
  taxableAmount: number;
  cgstRate?: number;
  cgstAmount?: number;
  sgstRate?: number;
  sgstAmount?: number;
  igstRate?: number;
  igstAmount?: number;
  totalAmount: number;
}

export interface Address {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  gstin?: string;
  pan?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  supplier: Address;
  customer: Address;
  placeOfSupply?: string;
  reverseCharge?: boolean;
  currency?: string;
  items: LineItem[];
  subtotal: number;
  totalDiscount?: number;
  totalCgst?: number;
  totalSgst?: number;
  totalIgst?: number;
  grandTotal: number;
  grandTotalInWords?: string;
  notes?: string;
  termsAndConditions?: string;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    branchName?: string;
  };
}

export interface PurchaseOrderData {
  poNumber: string;
  poDate: string;
  deliveryDate?: string;
  buyer: Address;
  vendor: Address;
  shippingAddress: Address;
  billingAddress: Address;
  currency?: string;
  items: LineItem[];
  subtotal: number;
  totalTax: number;
  grandTotal: number;
  grandTotalInWords?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  notes?: string;
}

export interface DocumentRenderOptions {
  format?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  preferSync?: boolean;
}

export interface GenerationJob {
  id: string;
  tenantId: string;
  documentId: string;
  documentType: DocumentType;
  status: GenerationJobStatus;
  idempotencyKey?: string | null;
  inputHash: string;
  inputPayload: Record<string, unknown>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  errorMessage?: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
}

export interface DocumentRecord {
  id: string;
  tenantId: string;
  documentId: string;
  jobId: string;
  documentType: DocumentType;
  templateVersion: string;
  storageKey: string;
  fileSizeBytes: number;
  sha256Checksum: string;
  renderDurationMs: number;
  createdAt: Date;
}

export interface BulkJob {
  id: string;
  tenantId: string;
  status: BulkJobStatus;
  totalDocuments: number;
  queuedDocuments: number;
  processingDocuments: number;
  completedDocuments: number;
  failedDocuments: number;
  archiveStorageKey?: string | null;
  archiveSizeBytes?: number | null;
  archiveChecksum?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}

export interface BulkJobItem {
  id: string;
  bulkJobId: string;
  tenantId: string;
  documentId: string;
  generationJobId: string;
  status: GenerationJobStatus;
  orderIndex: number;
  errorMessage?: string | null;
}

export interface DocumentAuditRecord {
  id: number;
  documentId: string;
  tenantId: string;
  action: 'generated' | 'downloaded' | 'verified' | 'archived';
  sha256Checksum: string;
  performedBy: string;
  ipAddress?: string | null;
  createdAt: Date;
}
