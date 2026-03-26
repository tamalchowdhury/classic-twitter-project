export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen max-w-7xl mx-auto flex">
      {/* Sidebar will go here */}
      <main className="flex-1 border-x border-gray-200">
        {children}
      </main>
      {/* Right sidebar will go here */}
    </div>
  );
}
