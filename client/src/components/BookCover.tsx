/** Cover image, or a coloured placeholder with the title's first letter. */
export function BookCover({
  url,
  title,
  className = 'h-32 w-24',
}: {
  url: string | null;
  title: string;
  className?: string;
}) {
  if (url)
    return <img src={url} alt="" loading="lazy" className={`${className} rounded object-cover`} />;
  return (
    <div
      aria-hidden
      className={`${className} grid place-items-center rounded bg-gradient-to-br from-brand-900 to-gray-900 text-3xl font-bold text-brand-50`}
    >
      {title.trim()[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

export function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="text-sm text-gray-500">No ratings</span>;
  return (
    <span className="text-sm text-yellow-400" aria-label={`Rated ${value} out of 5`}>
      {'★'.repeat(Math.round(value))}
      <span className="text-gray-600">{'★'.repeat(5 - Math.round(value))}</span>
      <span className="ml-1 text-gray-400">{value.toFixed(1)}</span>
    </span>
  );
}
