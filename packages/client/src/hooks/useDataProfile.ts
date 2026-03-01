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

import { useEffect, useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { useAppStore } from '../stores/useAppStore.js';
import type { DataProfile, EnrichableAttributes } from '@genome-hub/shared';

// ── Polling constants ────────────────────────────────────────────────────────

const POLL_INTERVAL = 1_000; // ms
const MAX_POLLS = 30;        // give up after 30s

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
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
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
  const mergeFileProfile = useAppStore(s => s.mergeFileProfile);

  // Seed local state from Zustand store if available, else from baseProfile
  const storeProfile = useAppStore(s => fileId ? s.fileProfiles[fileId]?.dataProfile ?? null : null);
  const [profile, setProfile] = useState<DataProfile | null>(storeProfile ?? baseProfile);
  const [loading, setLoading] = useState(false);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  // Sync base profile when it arrives (from useParquetPreview → Zustand → here)
  useEffect(() => {
    if (baseProfile && !profileRef.current) {
      setProfile(baseProfile);
    }
  }, [baseProfile]);

  // Sync from Zustand only if it has MORE enriched keys than local state.
  // Never overwrite an enriched profile with a base-only profile (causes flash).
  useEffect(() => {
    if (!storeProfile || storeProfile === profileRef.current) return;
    const local = profileRef.current;
    if (!local) {
      setProfile(storeProfile);
      return;
    }
    const storeHasMore = ['columnStats', 'cardinality', 'charLengths'].some(
      k => (storeProfile as Record<string, unknown>)[k] !== undefined &&
           (local as Record<string, unknown>)[k] === undefined
    );
    if (storeHasMore) setProfile(storeProfile);
  }, [storeProfile]);

  // Derive effective profile synchronously — eliminates the one-frame gap
  // where profile state is null but storeProfile/baseProfile are already available.
  const effectiveProfile = profile ?? storeProfile ?? baseProfile;

  // Compute which requested keys are missing (=== undefined, not null)
  const missingKeys = effectiveProfile
    ? attributes.filter(k => effectiveProfile[k] === undefined)
    : [];
  const missingStr = missingKeys.join(',');

  useEffect(() => {
    if (!fileId || !effectiveProfile || missingKeys.length === 0) return;
    const ac = new AbortController();
    setLoading(true);

    fetchProfileAttributes(fileId, missingKeys, ac.signal)
      .then(serverProfile => {
        if (ac.signal.aborted || !serverProfile) return;
        // Build the patch of enriched attributes
        const patch: Partial<DataProfile> = {};
        for (const key of attributes) {
          if (serverProfile[key] !== undefined) {
            (patch as Record<string, unknown>)[key] = serverProfile[key];
          }
        }
        if (serverProfile.profiledAt) patch.profiledAt = serverProfile.profiledAt;

        // Merge into local state
        setProfile(prev => prev ? { ...prev, ...patch } : serverProfile);

        // Merge into Zustand store — single source of truth
        if (fileId) mergeFileProfile(fileId, patch);
      })
      .catch(() => {
        // Fetch failed or aborted — don't poison the profile
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, missingStr]);

  return { profile: effectiveProfile, loading };
}
