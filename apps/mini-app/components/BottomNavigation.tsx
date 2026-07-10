'use client';

import Link from 'next/link';

import { bottomNavigationItems, profileNavigationItem } from '@/lib/navigation';

interface BottomNavigationProps {
  pathname: string;
}

function isNavigationItemActive(itemHref: string, pathname: string) {
  return pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}

export function BottomNavigation({ pathname }: BottomNavigationProps) {
  const isProfileActive = isNavigationItemActive(profileNavigationItem.href, pathname);

  return (
    <nav className="bottom-navigation" aria-label="Main navigation">
      <div className="bottom-navigation__group" aria-label="Primary navigation">
        {bottomNavigationItems.map((item) => {
          const isActive = isNavigationItemActive(item.href, pathname);

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
      </div>

      <Link
        className="bottom-navigation__item bottom-navigation__item--profile"
        data-active={isProfileActive}
        href={profileNavigationItem.href}
        aria-current={isProfileActive ? 'page' : undefined}
      >
        <span className="bottom-navigation__label">{profileNavigationItem.label}</span>
        <span className="bottom-navigation__title">{profileNavigationItem.title}</span>
      </Link>
    </nav>
  );
}
