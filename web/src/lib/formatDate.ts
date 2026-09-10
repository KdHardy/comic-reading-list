/** Display a stored date value as "Mmm dd, yyyy" (e.g. "Jun 02, 2021"). */
export function formatPublishDate(isoDate: string | null): string | null {
  if (!isoDate) return null;

  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parsed = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(isoDate);

  if (Number.isNaN(parsed.getTime())) return isoDate;

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}
