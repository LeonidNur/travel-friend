export interface NavigationItem {
  href: string;
  label: string;
  title: string;
  description: string;
}

export const bottomNavigationItems: NavigationItem[] = [
  {
    href: '/chats',
    label: 'Chats',
    title: 'Чаты',
    description: 'Группы поездок и переписка'
  },
  {
    href: '/',
    label: 'Discover',
    title: 'Discover',
    description: 'Поиск попутчиков и поездок'
  },
  {
    href: '/trips',
    label: 'Trips',
    title: 'Поездки',
    description: 'Ваши будущие и созданные поездки'
  }
];

export const profileNavigationItem: NavigationItem = {
  href: '/profile',
  label: 'Profile',
  title: 'Профиль',
  description: 'Профиль и интересы путешествий'
};

export const navigationItems: NavigationItem[] = [
  ...bottomNavigationItems,
  profileNavigationItem
];

export function getRouteMeta(pathname: string) {
  if (pathname.startsWith('/buddies/')) {
    return {
      href: pathname,
      label: 'Buddy',
      title: 'Публичный профиль',
      description: 'Расширенная анкета потенциального попутчика'
    };
  }

  if (pathname.startsWith('/chats/')) {
    return {
      href: pathname,
      label: 'Chat',
      title: 'Чат поездки',
      description: 'Локальная MVP-переписка по будущей поездке'
    };
  }

  return (
    navigationItems.find((item) => item.href === pathname) ??
    navigationItems.find((item) => item.href === '/') ??
    navigationItems[0]
  );
}
