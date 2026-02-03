export default function WorldPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-24 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
          World Viewer
        </h1>
        <p className="mt-4 max-w-xl text-base text-zinc-300">
          The live world view will appear here. Wiring to the real-time
          Moltwars backend is next.
        </p>
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 px-6 py-10 text-sm text-zinc-400">
          Coming online soon.
        </div>
      </main>
    </div>
  );
}
