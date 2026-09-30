/** Slow-moving aurora glows behind the whole app (purely decorative). */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -left-[20%] -top-[30%] h-[70vh] w-[70vw] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgb(226_41_74/0.38),transparent)] blur-3xl" />
      <div className="absolute -right-[15%] top-[10%] h-[60vh] w-[55vw] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgb(99_102_241/0.28),transparent)] blur-3xl [animation-delay:-6s]" />
      <div className="absolute -bottom-[25%] left-[20%] h-[55vh] w-[60vw] animate-aurora rounded-full bg-[radial-gradient(closest-side,rgb(226_187_102/0.2),transparent)] blur-3xl [animation-delay:-12s]" />
      {/* Fine grid, fading out towards the bottom */}
      <div className="absolute inset-0 bg-[linear-gradient(rgb(255_255_255/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.035)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
    </div>
  );
}
