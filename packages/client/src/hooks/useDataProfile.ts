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
  const [profile, setProfile] = useState<DataProfile | null>(baseProfile);
  const [loading, setLoading] = useState(false);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  // Sync base profile when it arrives from parquet-url
  useEffect(() => {
    if (baseProfile && !profileRef.current) {
      setProfile(baseProfile);
    }
  }, [baseProfile]);

  // Compute which requested keys are missing (=== undefined, not null)
  const missingKeys = profile
    ? attributes.filter(k => profile[k] === undefined)
    : [];
  const missingStr = missingKeys.join(',');

  useEffect(() => {
    if (!fileId || !profile || missingKeys.length === 0) return;
    let cancelled = false;
    setLoading(true);

    fetchProfileAttributes(fileId, missingKeys)
      .then(serverProfile => {
        if (cancelled) return;
        // Merge server response into local profile
        setProfile(prev => {
          if (!prev) return serverProfile;
          const merged = { ...prev };
          for (const key of attributes) {
            if (serverProfile[key] !== undefined) {
              // Explicit assignment for each key — type-safe
              (merged as Record<string, unknown>)[key] = serverProfile[key];
            }
          }
          if (serverProfile.profiledAt) merged.profiledAt = serverProfile.profiledAt;
          return merged;
        });
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

  return { profile, loading };
}
