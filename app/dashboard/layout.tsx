import { redirect } from 'next/navigation'
import { getStaffAccess } from '@/lib/admin-access'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, isAdmin } = await getStaffAccess()

  if (!user) {
    redirect('/auth/sign-in?next=/dashboard')
  }

  if (!isAdmin) {
    redirect('/')
  }

  return children
}
