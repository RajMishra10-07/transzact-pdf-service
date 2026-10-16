import { describe, it, expect } from 'vitest';
import {
  isValidGenerationTransition,
  isValidBulkTransition,
} from '../../src/domain/job-state.js';

describe('Job State Machine Transitions', () => {
  it('should allow valid generation job transitions', () => {
    expect(isValidGenerationTransition('queued', 'processing')).toBe(true);
    expect(isValidGenerationTransition('processing', 'completed')).toBe(true);
    expect(isValidGenerationTransition('processing', 'failed')).toBe(true);
    expect(isValidGenerationTransition('failed', 'queued')).toBe(true); // retry
  });

  it('should disallow invalid generation job transitions', () => {
    expect(isValidGenerationTransition('completed', 'queued')).toBe(false);
    expect(isValidGenerationTransition('completed', 'processing')).toBe(false);
    expect(isValidGenerationTransition('completed', 'failed')).toBe(false);
    expect(isValidGenerationTransition('queued', 'completed')).toBe(false); // must pass through processing
  });

  it('should allow valid bulk job transitions', () => {
    expect(isValidBulkTransition('queued', 'processing')).toBe(true);
    expect(isValidBulkTransition('processing', 'completed')).toBe(true);
    expect(isValidBulkTransition('processing', 'partially_completed')).toBe(true);
    expect(isValidBulkTransition('processing', 'failed')).toBe(true);
  });

  it('should disallow invalid bulk job transitions', () => {
    expect(isValidBulkTransition('completed', 'processing')).toBe(false);
    expect(isValidBulkTransition('partially_completed', 'queued')).toBe(false);
  });
});
