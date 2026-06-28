'use client';

import Link from 'next/link';

import { navigationItems } from '@/lib/navigation';

interface BottomNavigationProps {
  pathname: string;
}

export function BottomNavigation({ pathname }: BottomNavigationProps) {
  return (
    <nav className="bottom-navigation" aria-label="Main navigation">
      {navigationItems.map((item) => {
        const isActive = item.href === pathname;

        return (
          <Link
            key={item.href}
            className="bottom-navigation__item"
            data-active={isActive}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="bottom-navigation__label">{item.label}</span>
            <span className="bottom-navigation__title">{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
