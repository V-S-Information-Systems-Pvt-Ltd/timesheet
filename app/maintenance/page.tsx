import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Maintenance | VSIS Timesheet',
  robots: { index: false, follow: false },
}

export default function MaintenancePage() {
  return (
    <main id="main-content" className="flex min-h-screen flex-1 items-center justify-center bg-surface p-6">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-card sm:p-12">
        <p className="mb-4 text-sm font-semibold text-primary-700 dark:text-primary-200">VSIS Timesheet</p>
        <h1 className="text-3xl font-bold text-fg">Maintenance in progress</h1>
        <p className="mt-4 text-base leading-relaxed text-fg-muted">
          We&apos;re making a few updates. Please try again shortly.
        </p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- A full navigation retries server state instead of the client router cache. */}
        <a
          href="/"
          className="mt-8 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary-600 px-6 py-3 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-600"
        >
          Try again
        </a>
      </div>
    </main>
  )
}
