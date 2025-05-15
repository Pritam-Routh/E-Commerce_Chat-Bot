import React from 'react';
import { Button } from '@/components/ui/button';

// Define the navigation items for the external app
const navItems = [
  { label: 'Home', path: '/' },
  { label: 'Products', path: '/products' },
  { label: 'Cart', path: '/cart' },
  { label: 'Profile', path: '/profile' },
  { label: 'Seller Dashboard', path: '/seller/dashboard' },
  { label: 'Admin Dashboard', path: '/admin/dashboard' },
];

export function ExternalNavbar() {
  // All links point to the external app at localhost:8080
  const baseUrl = 'http://localhost:8080';

  return (
    <nav className="flex gap-2 items-center">
      {navItems.map((item) => (
        <a
          key={item.path}
          href={`${baseUrl}${item.path}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="ghost" size="sm" className="px-2 py-1">
            {item.label}
          </Button>
        </a>
      ))}
    </nav>
  );
}
