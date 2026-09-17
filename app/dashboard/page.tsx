import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import './dashboard.css';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // always fresh git + fs

export const metadata: Metadata = {
  title: 'RunDB · Build Dashboard',
  description: 'Mission control: plans, commit diffs, project status, and site map for RunDB.',
};

const TABS = ['overview', 'plans', 'commits', 'sitemap'] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // Development-only: the data layer shells out to git and reads plans/ + docs/,
  // which do not exist on serverless deploys. Keeping the import inside the env
  // branch lets Turbopack drop the git/fs module from production bundles and traces.
  if (process.env.NODE_ENV === 'development') {
    const { getDashboardData } = await import('@/lib/server/dashboard');
    const [data, params] = await Promise.all([getDashboardData(), searchParams]);
    const tab = TABS.includes(params.tab as (typeof TABS)[number]) ? params.tab! : 'overview';
    return <DashboardClient data={data} defaultTab={tab} />;
  }
  notFound();
}
