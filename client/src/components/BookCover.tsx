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
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        className={`${className} rounded-lg object-cover shadow-[0_10px_30px_-12px_rgb(0_0_0/0.8)]`}
      />
    );
  const [from, to] = COVER_TONES[hash(title) % COVER_TONES.length]!;
  return (
    <div
      aria-hidden
      style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}
      className={`${className} relative grid place-items-center overflow-hidden rounded-lg font-[family-name:var(--font-display)] text-3xl font-bold text-white/90 shadow-[0_10px_30px_-12px_rgb(0_0_0/0.8)]`}
    >
      {/* spine and a soft sheen, so it reads as a book */}
      <span className="absolute inset-y-0 left-0 w-1.5 bg-black/25" />
      <span className="absolute inset-0 bg-[linear-gradient(115deg,rgb(255_255_255/0.14),transparent_45%)]" />
      <span className="relative">{title.trim()[0]?.toUpperCase() ?? '?'}</span>
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

/** Cover colours for books without a cover image, picked by title. */
const COVER_TONES: [string, string][] = [
  ['#8e1330', '#2a0a14'],
  ['#3b3f9e', '#12143a'],
  ['#a57a2a', '#3a2808'],
  ['#1f6f6b', '#0a2624'],
  ['#6b2a8e', '#220b30'],
  ['#9c3d1e', '#2e1006'],
];

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
