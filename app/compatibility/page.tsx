import { CompatibilityChecker } from '@/components/compatibility-checker';

const STEPS = [
  'Pick your CPU and GPU from the catalog',
  'Save it: to your account when signed in, otherwise in this browser',
  'See predictions from similar rigs',
];

export default function CompatibilityPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6">
      <div className="mb-8">
        <div className="eyebrow">Will it run?</div>
        <h1 className="theme-page-title mt-2">Check your PC against real reports</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Enter your hardware once and see how it performs across games, based on community reports from similar rigs.
        </p>
        <ol className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-primary font-mono text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <CompatibilityChecker />
    </div>
  );
}
