/**
 * useDataProfile — Demand-driven lazy hydration of DataProfile attributes.
 *
 * Fetches specific enrichable attributes from the server's data-profile
 * endpoint. Only requests attributes that are missing (=== undefined)
 * from the current profile. Attributes that are null (negative cache)
 * are never re-fetched.
 *
 * Deduplication:
 *   - Module-level Promise cache keyed by fileId:sortedAttributes
 *   - Identical concurrent calls (including React Strict Mode double-fires)
 *     share a single in-flight fetch
 *   - Auto-cleans via .finally() — identical to SWR/React Query internals
 *
 * @module
 */

import { useEffect, useState, useRef } from 'react';
import { apiFetch } from '../lib/api.js';
import { useAppStore } from '../stores/useAppStore.js';
import type { DataProfile, EnrichableAttributes } from '@genome-hub/shared';

// ── Module-level Promise cache for deduplication ────────────────────────────

const fetchCache = new Map<string, Promise<DataProfile>>();

function fetchProfileAttributes(
  fileId: string,
  attrs: (keyof EnrichableAttributes)[],
): Promise<DataProfile> {
  const key = `${fileId}:${[...attrs].sort().join(',')}`;
  const existing = fetchCache.get(key);
  if (existing) return existing;

  const promise = apiFetch(
    `/api/files/${fileId}/data-profile?attributes=${attrs.join(',')}`
  )
    .then(r => {
      if (!r.ok) throw new Error(`data-profile returned ${r.status}`);
      return r.json();
    })
    .then(data => data.profile as DataProfile)
    .finally(() => fetchCache.delete(key));

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
      console.log('[DP:zustandSync] No local profile, adopting store');
      setProfile(storeProfile);
      return;
    }
    const storeHasMore = ['columnStats', 'cardinality', 'charLengths'].some(
      k => (storeProfile as Record<string, unknown>)[k] !== undefined &&
           (local as Record<string, unknown>)[k] === undefined
    );
    console.log('[DP:zustandSync]', { storeHasMore, storeKeys: Object.keys(storeProfile), localKeys: Object.keys(local) });
    if (storeHasMore) setProfile(storeProfile);
  }, [storeProfile]);

  // Derive effective profile synchronously — eliminates the one-frame gap
  // where profile state is null but storeProfile/baseProfile are already available.
  // Without this, the sidebar flashes from "no stats" to "stats" on every page load.
  const effectiveProfile = profile ?? storeProfile ?? baseProfile;

  // Compute which requested keys are missing (=== undefined, not null)
  const missingKeys = effectiveProfile
    ? attributes.filter(k => effectiveProfile[k] === undefined)
    : [];
  const missingStr = missingKeys.join(',');
  console.log('[DP:eval]', {
    fileId: fileId?.slice(0, 8),
    hasProfile: !!effectiveProfile,
    source: profile ? 'local' : storeProfile ? 'zustand' : baseProfile ? 'base' : 'none',
    missingKeys,
    profileKeys: effectiveProfile ? Object.keys(effectiveProfile) : [],
  });

  useEffect(() => {
    if (!fileId || !effectiveProfile || missingKeys.length === 0) {
      console.log('[DP:effect] Skipping fetch:', { fileId: !!fileId, hasProfile: !!effectiveProfile, missingCount: missingKeys.length });
      return;
    }
    console.log('[DP:effect] Fetching:', missingKeys);
    let cancelled = false;
    setLoading(true);

    fetchProfileAttributes(fileId, missingKeys)
      .then(serverProfile => {
        if (cancelled) return;
        console.log('[DP:fetched]', { keys: Object.keys(serverProfile) });
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
        // Fetch failed — don't poison the profile, just stop loading
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, missingStr]);

  return { profile: effectiveProfile, loading };
}
