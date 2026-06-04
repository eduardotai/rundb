import { CompatibilityChecker } from '@/components/compatibility-checker';

export default function CompatibilityPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Will It Run?</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Enter your hardware once. Instantly see how it would perform in dozens of games based on thousands of real community reports.
        </p>
      </div>

      <CompatibilityChecker />
    </div>
  );
}
