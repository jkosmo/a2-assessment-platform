import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pseudonymizeUser } from '../../src/modules/user/pseudonymizationService.js';
import { pseudonymizationRepository } from '../../src/modules/user/pseudonymizationRepository.js';
import * as transaction from '../../src/db/transaction.js';
import { DeletionTrigger } from '@prisma/client';

vi.mock('../../src/modules/user/pseudonymizationRepository.js', () => ({
  pseudonymizationRepository: {
    findUserAnonymizationState: vi.fn(),
  },
  createPseudonymizationRepository: vi.fn(() => ({
    cancelAssessmentJobsForUser: vi.fn().mockResolvedValue({ count: 2 }),
    pseudonymizeUser: vi.fn().mockResolvedValue({}),
    completePendingDeletionRequestsForUser: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('../../src/db/transaction.js', () => ({
  runInTransaction: vi.fn((cb) => cb({})),
}));

vi.mock('../../src/services/auditService.js', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue({}),
}));

describe('pseudonymizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skal kaste feil hvis brukeren ikke finnes', async () => {
    vi.mocked(pseudonymizationRepository.findUserAnonymizationState).mockResolvedValue(null);

    await expect(pseudonymizeUser('user-123', DeletionTrigger.USER_REQUEST))
      .rejects.toThrow('User user-123 not found.');
  });

  it('skal returnere tidlig hvis brukeren allerede er anonymisert', async () => {
    vi.mocked(pseudonymizationRepository.findUserAnonymizationState).mockResolvedValue({
      id: 'user-123',
      isAnonymized: true,
    } as any);

    const result = await pseudonymizeUser('user-123', DeletionTrigger.USER_REQUEST);

    expect(result.cancelledJobCount).toBe(0);
    expect(transaction.runInTransaction).not.toHaveBeenCalled();
  });

  it('skal gjennomføre pseudonymisering for en aktiv bruker', async () => {
    vi.mocked(pseudonymizationRepository.findUserAnonymizationState).mockResolvedValue({
      id: 'user-123',
      isAnonymized: false,
    } as any);

    const result = await pseudonymizeUser('user-123', DeletionTrigger.USER_REQUEST);

    expect(result.userId).toBe('user-123');
    expect(result.cancelledJobCount).toBe(2);
  });
});