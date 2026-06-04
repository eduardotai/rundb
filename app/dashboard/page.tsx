import type { Metadata } from 'next';
import { getDashboardData } from '@/lib/server/dashboard';
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
  const [data, params] = await Promise.all([getDashboardData(), searchParams]);
  const tab = TABS.includes(params.tab as (typeof TABS)[number]) ? params.tab! : 'overview';
  return <DashboardClient data={data} defaultTab={tab} />;
}
