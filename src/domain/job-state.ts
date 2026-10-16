export type GenerationJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type BulkJobStatus = 'queued' | 'processing' | 'completed' | 'partially_completed' | 'failed';

const VALID_GENERATION_TRANSITIONS: Record<GenerationJobStatus, GenerationJobStatus[]> = {
  queued: ['processing', 'failed'],
  processing: ['completed', 'failed', 'queued'], // queued if retryable failure
  completed: [],
  failed: ['queued'], // re-enqueued on retry
};

const VALID_BULK_TRANSITIONS: Record<BulkJobStatus, BulkJobStatus[]> = {
  queued: ['processing', 'failed'],
  processing: ['completed', 'partially_completed', 'failed'],
  completed: [],
  partially_completed: [],
  failed: [],
};

export function isValidGenerationTransition(
  current: GenerationJobStatus,
  next: GenerationJobStatus
): boolean {
  return VALID_GENERATION_TRANSITIONS[current]?.includes(next) ?? false;
}

export function isValidBulkTransition(current: BulkJobStatus, next: BulkJobStatus): boolean {
  return VALID_BULK_TRANSITIONS[current]?.includes(next) ?? false;
}
