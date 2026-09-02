import AdminSidebar from '@/components/admin/AdminSidebar';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0C0A09] text-stone-100 flex flex-col md:flex-row">
      <AdminSidebar />
      <div className="flex-1 overflow-x-hidden min-w-0 bg-[#0C0A09]">
        {children}
      </div>
    </div>
  );
}
