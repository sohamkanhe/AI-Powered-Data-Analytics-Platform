import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "./layouts/DashboardLayout";

// Stubs & Pages
import Auth from "./pages/Auth"; // <-- Import the new Auth page
import DataSources from "./pages/DataSources";
import Workspaces from "./pages/Workspaces";
import DataSourceChat from "./pages/DataSourceChat";
import WorkspaceNotebook from "./pages/WorkspaceNotebook";

import React from "react";

function Settings() {
  return (
    <div className="p-8 text-white space-y-4">
      <h1 className="text-2xl font-bold">Account Settings</h1>
      <button 
        onClick={() => {
          localStorage.removeItem("token");
          window.location.href = "/login";
        }}
        className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}

// --- ROUTE GUARD ---
// This wrapper checks for a token before rendering its children
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("token");
  
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Auth Route */}
        <Route path="/login" element={<Auth />} />

        {/* Protected Dashboard Routes */}
        <Route 
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DataSources />} />
          <Route path="/datasources" element={<DataSources />} />
          <Route path="/datasources/:id" element={<DataSourceChat />} />
          
          <Route path="/workspaces/*" element={<Workspaces />} />
          <Route path="/workspaces/:id" element={<WorkspaceNotebook />} />
          
          <Route path="/settings" element={<Settings />} />
        </Route>
        
        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}