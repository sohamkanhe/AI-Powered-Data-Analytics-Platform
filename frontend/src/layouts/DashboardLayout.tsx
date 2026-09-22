import { Link, useLocation, Outlet } from "react-router-dom";
import { 
  Database, 
  TerminalSquare, 
  Settings, 
  Sparkles
} from "lucide-react";

export default function DashboardLayout() {
  const location = useLocation();

  const navItems = [
    { name: "Data Sources", href: "/", icon: Database },
    { name: "Workspaces", href: "/workspaces", icon: TerminalSquare },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-gray-100 font-sans selection:bg-blue-500/30">
      
      {/* Sidebar - Glassmorphism effect */}
      <aside className="w-64 border-r border-white/10 bg-black/40 backdrop-blur-xl flex flex-col z-20">
        
        {/* Brand Header */}
        <div className="h-16 flex items-center px-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.4)]">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              Insights
            </span>
          </div>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 px-4 py-6 space-y-1.5">
          {navItems.map((item) => {
            // Check if active (handle root vs sub-paths)
            const isActive = item.href === "/" 
              ? location.pathname === "/" 
              : location.pathname.startsWith(item.href);
              
            const Icon = item.icon;
            
            return (
              <Link key={item.name} to={item.href}>
                <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
                  isActive 
                    ? "bg-white/10 text-white shadow-inner" 
                    : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`}>
                  <Icon className={`w-5 h-5 ${isActive ? "text-blue-400" : "group-hover:text-blue-400 transition-colors"}`} />
                  <span className="font-medium text-sm">{item.name}</span>
                  
                  {/* Glowing active dot */}
                  {isActive && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* User Profile Stub */}
        <div className="p-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-400 to-cyan-500 border border-white/10 shadow-inner" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-gray-200">Manthan Khawse</span>
              <span className="text-xs text-gray-500">Admin</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area with lively background */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-900/10 via-[#0A0A0A] to-[#0A0A0A]">
        {/* <Outlet /> is where your page components physically render */}
        <div className="flex-1 overflow-y-auto">
          <Outlet /> 
        </div>
      </main>

    </div>
  );
}