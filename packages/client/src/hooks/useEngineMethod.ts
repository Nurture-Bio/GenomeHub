/**
 * useEngineMethod — single-axis FSM for engine method dispatch + job polling.
 *
 * One `Phase` drives everything. The stepper's active dot is determined by
 * poll data (status + step fields) mapped against the method's step array,
 * not by the FSM phase itself. This keeps the FSM simple (6 phases) while
 * the stepper can show 3–12 dots.
 *
 * Terminal animations (completing/failing → fading → idle) are driven by
 * timer refs cleaned up on unmount and cancel.
 */

import { useReducer, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { createElement } from 'react';
import { apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { mutateApi } from '../lib/queryFn';
import { useEngineJobQuery } from './useGenomicQueries';

// ── Phase type ────────────────────────────────────────

export type Phase =
  | 'idle'          // nothing happening
  | 'dispatching'   // POST in flight
  | 'active'        // job polling (covers queued + running + saving)
  | 'completing'    // terminal flourish hold
  | 'failing'       // error hold (red dot)
  | 'fading';       // opacity → 0, then → idle

export interface EngineProgress {
  pct_complete: number | null;
  rate_per_sec: number | null;
  eta_seconds: number | null;
}

export interface EngineMethodResult {
  fileId: string;
  filename: string;
}

// ── Reducer ──────────────────────────────────────────

interface State {
  phase: Phase;
  jobId: string | null;
  error: string | null;
  result: EngineMethodResult | null;
  pollLost: boolean;
  failedAtStep: number | null;
}

const INITIAL: State = {
  phase: 'idle',
  jobId: null,
  error: null,
  result: null,
  pollLost: false,
  failedAtStep: null,
};

type Action =
  | { type: 'DISPATCH' }
  | { type: 'SUBMITTED'; jobId: string }
  | { type: 'SYNC_COMPLETE'; result: EngineMethodResult }
  | { type: 'DISPATCH_ERROR'; error: string }
  | { type: 'JOB_COMPLETE'; result: EngineMethodResult | null }
  | { type: 'JOB_FAILED'; error: string; failedAtStep: number }
  | { type: 'POLL_LOST' }
  | { type: 'POLL_RECOVERED' }
  | { type: 'FADE' }
  | { type: 'RESET' }
  | { type: 'CANCEL' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'DISPATCH':
      return { ...INITIAL, phase: 'dispatching' };
    case 'SUBMITTED':
      return { ...state, phase: 'active', jobId: action.jobId, pollLost: false };
    case 'SYNC_COMPLETE':
      return { ...state, phase: 'completing', result: action.result, jobId: null, pollLost: false };
    case 'DISPATCH_ERROR':
      return { ...state, phase: 'failing', error: action.error, jobId: null, pollLost: false, failedAtStep: 0 };
    case 'JOB_COMPLETE':
      return { ...state, phase: 'completing', result: action.result, jobId: null, pollLost: false };
    case 'JOB_FAILED':
      return { ...state, phase: 'failing', error: action.error, jobId: null, pollLost: false, failedAtStep: action.failedAtStep };
    case 'POLL_LOST':
      return state.pollLost ? state : { ...state, pollLost: true };
    case 'POLL_RECOVERED':
      return state.pollLost ? { ...state, pollLost: false } : state;
    case 'FADE':
      return { ...state, phase: 'fading' };
    case 'RESET':
      return INITIAL;
    case 'CANCEL':
      return INITIAL;
  }
}

// ── Terminal animation durations ─────────────────────

const COMPLETE_HOLD_MS = 1200;
const FAIL_HOLD_MS     = 2000;
const FADE_MS          = 618; // φ duration

// ── Hook ─────────────────────────────────────────────

export function useEngineMethod() {
  const qc = useQueryClient();
  const [state, send] = useReducer(reducer, INITIAL);

  // Abort dispatch on unmount
  const abortRef = useRef<AbortController | null>(null);
  // Track which jobId we already handled terminal for
  const terminalHandledRef = useRef<string | null>(null);
  // Timer refs for terminal animation
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (fadeTimerRef.current) { clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; }
  }, []);

  // TanStack Query polling — enabled only when we have an active job
  const { data: jobData, isError: pollError, failureCount } = useEngineJobQuery(state.jobId ?? undefined);

  // Track poll health — transient loss, not terminal
  useEffect(() => {
    if (!state.jobId) return;
    if (pollError && failureCount >= 2) {
      send({ type: 'POLL_LOST' });
    } else if (!pollError && state.pollLost) {
      send({ type: 'POLL_RECOVERED' });
    }
  }, [pollError, failureCount, state.jobId, state.pollLost]);

  // Extract live poll data
  const progress: EngineProgress | null = state.jobId
    ? (jobData?.progress ?? null)
    : null;
  const pollStep: string | null = state.jobId ? (jobData?.step ?? null) : null;
  const pollStatus: string | null = state.jobId ? (jobData?.status ?? null) : null;
  const stage: string | null = state.jobId ? (jobData?.stage ?? null) : null;
  const items: { complete: number; total: number } | null = state.jobId ? (jobData?.items ?? null) : null;

  // Terminal transitions — useEffect reacting to external query data changes
  useEffect(() => {
    if (!jobData || !state.jobId) return;
    if (terminalHandledRef.current === state.jobId) return;

    if (jobData.status === 'complete') {
      terminalHandledRef.current = state.jobId;
      const fileId = jobData.fileId;
      const filename = jobData.filename;
      const result = fileId ? { fileId, filename: filename ?? 'result' } : null;

      send({ type: 'JOB_COMPLETE', result });
      qc.invalidateQueries({ queryKey: queryKeys.files.all });
      qc.invalidateQueries({ queryKey: queryKeys.stats.storage });

      if (fileId) {
        toast.success(createElement(
          Link,
          { to: `/files/${fileId}`, className: 'no-underline hover:underline' },
          filename ?? 'View result',
        ));
      } else {
        toast.success(filename ?? 'Done');
      }
    } else if (jobData.status === 'failed') {
      terminalHandledRef.current = state.jobId;
      const msg = jobData.error ?? 'Method failed';
      // failedAtStep will be resolved by the consumer using resolveActiveStep
      send({ type: 'JOB_FAILED', error: msg, failedAtStep: -1 });
      toast.error(msg);
    }
  }, [jobData, state.jobId, qc]);

  // Terminal animation: completing/failing → fade → reset
  useEffect(() => {
    if (state.phase === 'completing') {
      clearTimers();
      holdTimerRef.current = setTimeout(() => send({ type: 'FADE' }), COMPLETE_HOLD_MS);
    } else if (state.phase === 'failing') {
      clearTimers();
      holdTimerRef.current = setTimeout(() => send({ type: 'FADE' }), FAIL_HOLD_MS);
    } else if (state.phase === 'fading') {
      clearTimers();
      fadeTimerRef.current = setTimeout(() => send({ type: 'RESET' }), FADE_MS);
    }
  }, [state.phase, clearTimers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearTimers();
    };
  }, [clearTimers]);

  const run = useCallback((engineId: string, methodId: string, params: Record<string, string>) => {
    abortRef.current?.abort();
    clearTimers();
    const ac = new AbortController();
    abortRef.current = ac;
    terminalHandledRef.current = null;

    send({ type: 'DISPATCH' });

    mutateApi<{ fileId?: string; filename?: string; jobId?: string }>(
      `/api/engines/${engineId}/methods/${methodId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: ac.signal,
      },
    )
      .then((res) => {
        if (ac.signal.aborted) return;
        if (res?.jobId) {
          send({ type: 'SUBMITTED', jobId: res.jobId });
        } else if (res?.fileId) {
          const result = { fileId: res.fileId, filename: res.filename ?? 'result' };
          send({ type: 'SYNC_COMPLETE', result });
          qc.invalidateQueries({ queryKey: queryKeys.files.all });
          qc.invalidateQueries({ queryKey: queryKeys.stats.storage });
          toast.success(createElement(
            Link,
            { to: `/files/${res.fileId}`, className: 'no-underline hover:underline' },
            res.filename ?? 'View result',
          ));
        }
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'Method dispatch failed';
        send({ type: 'DISPATCH_ERROR', error: msg });
        toast.error(msg);
      });
  }, [qc, clearTimers]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    clearTimers();
    if (state.jobId) {
      apiFetch(`/api/engines/jobs/${state.jobId}`, { method: 'DELETE' })
        .catch(() => {});
    }
    send({ type: 'CANCEL' });
  }, [state.jobId, clearTimers]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    clearTimers();
    terminalHandledRef.current = null;
    send({ type: 'RESET' });
  }, [clearTimers]);

  return {
    phase: state.phase,
    progress,
    pollStep,
    pollStatus,
    stage,
    items,
    error: state.error,
    result: state.result,
    pollLost: state.pollLost,
    failedAtStep: state.failedAtStep,
    run,
    cancel,
    reset,
  };
}
