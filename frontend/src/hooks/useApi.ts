import { useState, useEffect, useCallback } from 'react';

interface UseApiOptions<T> {
  immediate?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

export function useApi<T>(
  apiFunction: () => Promise<T>,
  options: UseApiOptions<T> = {}
) {
  const { immediate = true, onSuccess, onError } = options;
  
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await apiFunction();
      setData(result);
      onSuccess?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Erro desconhecido');
      setError(error);
      onError?.(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [apiFunction, onSuccess, onError]);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [immediate, execute]);

  const mutate = useCallback((newData: T | ((prev: T | null) => T | null)) => {
    if (typeof newData === 'function') {
      setData(prev => newData(prev));
    } else {
      setData(newData);
    }
  }, []);

  return { data, error, isLoading, execute, mutate };
}

export function useMutation<TInput, TOutput>(
  apiFunction: (input: TInput) => Promise<TOutput>,
  options: {
    onSuccess?: (data: TOutput, input: TInput) => void;
    onError?: (error: Error, input: TInput) => void;
  } = {}
) {
  const [data, setData] = useState<TOutput | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const mutate = useCallback(async (input: TInput) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await apiFunction(input);
      setData(result);
      options.onSuccess?.(result, input);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Erro desconhecido');
      setError(error);
      options.onError?.(error, input);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [apiFunction, options]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return { data, error, isLoading, mutate, reset };
}