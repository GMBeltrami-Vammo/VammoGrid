import { signIn } from '@/auth';

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black">
      {/* Dot-grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(46,194,255,0.10) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Top blue glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-96 -translate-x-1/2 rounded-full bg-brand-500/15 blur-3xl"
      />

      {/* Single pixel blue rule at very top */}
      <div aria-hidden className="absolute top-0 inset-x-0 h-px bg-brand-500/40" />

      {/* Content */}
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-8 px-6">
        {/* Wordmark */}
        <div className="text-center">
          <div className="flex items-baseline justify-center">
            <span className="text-5xl font-black uppercase tracking-[-0.04em] text-white">
              vammo
            </span>
            <span className="text-5xl font-black uppercase tracking-[-0.04em] text-brand-500">
              grid
            </span>
          </div>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/30">
            Gestão de Estoque
          </p>
        </div>

        {/* Blue rule divider */}
        <div className="h-px w-12 bg-brand-500/50" />

        {/* Login card */}
        <div className="w-full border border-white/10 bg-white/[0.03] px-8 py-8">
          <p className="mb-7 text-center text-xs text-white/40">
            Acesso restrito a colaboradores Vammo.
          </p>

          <form
            action={async () => {
              'use server';
              await signIn('google', { redirectTo: '/dashboard' });
            }}
          >
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-3 bg-brand-500 px-4 py-3 text-sm font-bold uppercase tracking-wider text-black transition-colors hover:bg-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
            >
              <GoogleIcon />
              Entrar com Google
            </button>
          </form>
        </div>
      </div>

      {/* Bottom attribution */}
      <p className="absolute bottom-6 text-[10px] text-white/15 tracking-wider uppercase">
        Vammo · Interno
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
