import React, { useState } from "react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  return (
    <div className={isDarkMode ? "dark" : "light"} data-compact={isCompact}>
      <button onClick={() => setIsSidebarOpen((v) => !v)}>Menu</button>
      <button onClick={() => setIsDarkMode((v) => !v)}>Theme</button>
      <button onClick={() => setIsCompact((v) => !v)}>Density</button>
      {isSidebarOpen && <nav>Sidebar</nav>}
      <main>{children}</main>
    </div>
  );
}
