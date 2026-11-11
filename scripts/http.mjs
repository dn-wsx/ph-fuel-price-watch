import { setTimeout as sleep } from 'node:timers/promises';

// Keep the deadline active through body consumption, not just receipt of headers.
export async function readUrl(url, { format = 'text', timeoutMs = 25_000, attempts = 3, signal, fetchImpl = fetch, sleepImpl = sleep, ...init } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: combined });
      if (!response.ok) {
        await response.body?.cancel();
        const error = new Error(`HTTP ${response.status}`);
        error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      const body = await response[format]();
      return { body, headers: response.headers };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const transient = deadline.aborted || error.name === 'TimeoutError' || error.retryable === true || (error instanceof TypeError && /fetch|network|terminated/i.test(error.message));
      if (!transient || attempt === attempts) {
        if (deadline.aborted) throw new Error(`Request timed out after ${timeoutMs}ms (${attempt} attempts): ${url}`, { cause: error });
        if (transient) throw new Error(`${error.message} after ${attempt} attempts: ${url}`, { cause: error });
        throw error;
      }
      const retryAfter = Number(response?.headers?.get('retry-after'));
      const delay = Math.min(10_000, retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1));
      await sleepImpl(delay, undefined, { signal });
    }
  }
}
