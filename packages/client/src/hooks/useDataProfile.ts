/**
 * useDataProfile — Demand-driven lazy hydration of DataProfile attributes.
 *
 * Fetches specific enrichable attributes from the server's data-profile
 * endpoint. Only requests attributes that are missing (=== undefined)
 * from the current profile. Attributes that are null (negative cache)
 * are never re-fetched.
 *
 * Async protocol:
 *   - Server returns 200 when all requested keys are cached → done.
 *   - Server returns 202 when keys are being computed → poll every 1s.
 *   - Polling stops on 200, cancellation, or MAX_POLLS reached.
 *
 * Deduplication:
 *   - Module-level Promise cache keyed by fileId:sortedAttributes
 *   - Identical concurrent calls (including React Strict Mode double-fires)
 *     share a single in-flight fetch+poll cycle
 *   - Auto-cleans via .finally()
 *
 * @module
 */

import { useEffect } from 'react';
import { apiFetch } from '../lib/api.js';
import { useAppStore } from '../stores/useAppStore.js';
import { useDerivedState } from './useDerivedState.js';
import type { DataProfile, EnrichableAttributes } from '@genome-hub/shared';

// ── Polling constants ────────────────────────────────────────────────────────

const POLL_INTERVAL = 1_000; // ms
const MAX_POLLS = 30; // give up after 30s

// ── Module-level Promise cache for deduplication ────────────────────────────

const fetchCache = new Map<string, Promise<DataProfile | null>>();

function fetchProfileAttributes(
  fileId: string,
  attrs: (keyof EnrichableAttributes)[],
  signal: AbortSignal,
): Promise<DataProfile | null> {
  const key = `${fileId}:${[...attrs].sort().join(',')}`;
  const existing = fetchCache.get(key);
  if (existing) return existing;

  const url = `/api/files/${fileId}/data-profile?attributes=${attrs.join(',')}`;

  const promise = (async () => {
    let polls = 0;
    while (!signal.aborted) {
      const r = await apiFetch(url, { signal });
      const data = await r.json();

      // 200 = all keys cached, done
      if (r.status === 200) return data.profile as DataProfile;

      // 202 = computing, poll again
      if (r.status === 202) {
        polls++;
        if (polls >= MAX_POLLS) return data.profile as DataProfile | null;
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }

      // Unexpected status
      throw new Error(`data-profile returned ${r.status}`);
    }
    return null; // cancelled
  })().finally(() => fetchCache.delete(key));

  fetchCache.set(key, promise);
  return promise;
}

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * Fetch specific DataProfile attributes from the server.
 *
 * @param fileId      - The file to profile
 * @param attributes  - Which enrichable attributes the UI needs
 * @param baseProfile - The base profile from parquet-url (schema + rowCount),
 *                      or null if not yet available. The hook merges server
 *                      responses into this base.
 *
 * Returns the merged profile and a loading flag. Components should check
 * `profile.columnStats === null` to render "not available" vs a spinner.
 */
export function useDataProfile(
  fileId: string | null,
  attributes: (keyof EnrichableAttributes)[],
  baseProfile: DataProfile | null,
): { profile: DataProfile | null; loading: boolean } {
  const mergeFileProfile = useAppStore((s) => s.mergeFileProfile);

  // Read Zustand store — may already have enriched attrs from a prior mount.
  const storeProfile = useAppStore((s) =>
    fileId ? (s.fileProfiles[fileId]?.dataProfile ?? null) : null,
  );

  // Effective profile: merge base sources + server fetch patch synchronously.
  // Priority: fetchPatch > storeProfile > baseProfile.
  // No useEffect sync — zero nested-update re-renders.
  const [effectiveProfile, setFetchPatch] = useDerivedState(
    (patch: Partial<DataProfile>) => {
      const base = storeProfile ?? baseProfile;
      if (!base) return null;
      return Object.keys(patch).length > 0 ? { ...base, ...patch } : base;
    },
    [storeProfile, baseProfile],
    {} as Partial<DataProfile>,
  );

  // Compute which requested keys are missing (=== undefined, not null)
  const missingKeys = effectiveProfile
    ? attributes.filter((k) => effectiveProfile[k] === undefined)
    : [];
  const missingStr = missingKeys.join(',');

  // Loading derived synchronously — true when we have missing keys to fetch.
  // When fetch completes → setFetchPatch fills the keys → missingKeys empties
  // → loading becomes false. No setLoading setState needed.
  const loading = fileId !== null && missingKeys.length > 0;

  useEffect(() => {
    if (!fileId || !effectiveProfile || missingKeys.length === 0) return;
    const ac = new AbortController();

    fetchProfileAttributes(fileId, missingKeys, ac.signal)
      .then((serverProfile) => {
        if (ac.signal.aborted || !serverProfile) return;
        const patch: Partial<DataProfile> = {};
        for (const key of attributes) {
          if (serverProfile[key] !== undefined) {
            (patch as Record<string, unknown>)[key] = serverProfile[key];
          }
        }
        if (serverProfile.profiledAt) patch.profiledAt = serverProfile.profiledAt;

        // Merge into local patch state
        setFetchPatch((prev) => ({ ...prev, ...patch }));

        // Merge into Zustand store — single source of truth
        if (fileId) mergeFileProfile(fileId, patch);
      })
      .catch(() => {
        // Fetch failed or aborted — don't poison the profile
      });

    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, missingStr]);

  return { profile: effectiveProfile, loading };
}
