/**
 * Auto-detect service type and default label from a URL.
 */

export type LinkService =
  | 'jira'
  | 'confluence'
  | 'slack'
  | 'google-doc'
  | 'google-sheet'
  | 'google-drive'
  | 'github'
  | 'notion'
  | 'benchling'
  | 'ncbi'
  | 'ebi'
  | 'protocols-io'
  | 'link';

interface DetectionResult {
  service: LinkService;
  label: string | null;
}

const RULES: {
  pattern: RegExp;
  service: LinkService;
  extractLabel?: (url: URL, match: RegExpMatchArray) => string | null;
}[] = [
  {
    pattern: /atlassian\.net\/(browse|jira)\//,
    service: 'jira',
    extractLabel: (url) => {
      // Extract ticket ID like PROJ-123 from /browse/PROJ-123 or /jira/.../PROJ-123
      const match = url.pathname.match(/([A-Z][A-Z0-9]+-\d+)/);
      return match ? match[1] : null;
    },
  },
  {
    pattern: /atlassian\.net\/wiki\//,
    service: 'confluence',
  },
  {
    pattern: /slack\.com\/archives\//,
    service: 'slack',
    extractLabel: (url) => {
      // /archives/C0123ABC → channel ID (not ideal, but best we can do without API)
      const parts = url.pathname.split('/');
      const idx = parts.indexOf('archives');
      return idx >= 0 && parts[idx + 1] ? `#${parts[idx + 1]}` : null;
    },
  },
  {
    pattern: /docs\.google\.com\/document\//,
    service: 'google-doc',
  },
  {
    pattern: /docs\.google\.com\/spreadsheets\//,
    service: 'google-sheet',
  },
  {
    pattern: /drive\.google\.com\//,
    service: 'google-drive',
  },
  {
    pattern: /github\.com\//,
    service: 'github',
    extractLabel: (url) => {
      // /owner/repo → owner/repo
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
      return null;
    },
  },
  {
    pattern: /notion\.so\//,
    service: 'notion',
  },
  {
    pattern: /benchling\.com\//,
    service: 'benchling',
  },
  {
    pattern: /ncbi\.nlm\.nih\.gov\//,
    service: 'ncbi',
  },
  {
    pattern: /ebi\.ac\.uk\//,
    service: 'ebi',
  },
  {
    pattern: /protocols\.io\//,
    service: 'protocols-io',
  },
];

export function detectLinkService(rawUrl: string): DetectionResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { service: 'link', label: null };
  }

  for (const rule of RULES) {
    const match = rawUrl.match(rule.pattern);
    if (match) {
      const label = rule.extractLabel ? rule.extractLabel(parsed, match) : null;
      return { service: rule.service, label };
    }
  }

  return { service: 'link', label: null };
}
