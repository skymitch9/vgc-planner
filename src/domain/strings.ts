/** Showdown-style id: lowercase letters and digits only. */
export const toID = (s: string | null | undefined): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** URL/file friendly slug. */
export const slug = (s: string | null | undefined): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’.:]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A name usable as a file name everywhere: keeps case and spaces, drops what Windows and macOS refuse. */
export const fileName = (s: string | null | undefined, fallback = 'team'): string => {
  const clean = String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 100)
    .trim();
  return clean || fallback;
};

export const round1= (n: number): number => Math.round(n * 10) / 10;
