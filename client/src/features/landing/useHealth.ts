import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@libraverse/shared';
import { api } from '../../lib/api';

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => api<HealthResponse>('/api/health') });
}
