const API_BASE = '/api';

export const getStoredToken = () => localStorage.getItem('newtonite_token');
export const setStoredToken = (token: string) => localStorage.setItem('newtonite_token', token);
export const removeStoredToken = () => localStorage.removeItem('newtonite_token');

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit & { idempotencyKey?: string } = {}
): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>)
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Generate or pass Idempotency-Key for mutating requests
  if (['POST', 'PATCH', 'PUT'].includes(options.method?.toUpperCase() || 'GET')) {
    headers['Idempotency-Key'] = options.idempotencyKey || `key-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    let errData: any = {};
    try {
      errData = await response.json();
    } catch {
      errData = { error: response.statusText };
    }
    throw new ApiError(errData.error || `Request failed with status ${response.status}`, response.status, errData);
  }

  return response.json();
}
