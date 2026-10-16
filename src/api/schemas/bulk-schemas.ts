import { z } from 'zod';
import { generateDocumentSchema } from './document-schemas.js';

export const bulkDocumentItemSchema = generateDocumentSchema;

export const bulkRequestSchema = z.object({
  tenantId: z.string().min(1).max(100),
  documents: z
    .array(bulkDocumentItemSchema)
    .min(1, 'Bulk request must contain at least 1 document')
    .max(100, 'Bulk request cannot exceed 100 documents'),
});

export type BulkRequest = z.infer<typeof bulkRequestSchema>;
