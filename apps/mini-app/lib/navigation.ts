export interface NavigationItem {
  href: string;
  label: string;
  title: string;
  description: string;
}

export const navigationItems: NavigationItem[] = [
  {
    href: '/',
    label: 'Home',
    title: 'Главная',
    description: 'Поиск попутчиков и поездок'
  },
  {
    href: '/chats',
    label: 'Chats',
    title: 'Чаты',
    description: 'Группы поездок и переписка'
  },
  {
    href: '/trips',
    label: 'Trips',
    title: 'Поездки',
    description: 'Ваши будущие и созданные поездки'
  },
  {
    href: '/profile',
    label: 'Profile',
    title: 'Профиль',
    description: 'Профиль и интересы путешествий'
  }
];

export function getRouteMeta(pathname: string) {
  return navigationItems.find((item) => item.href === pathname) ?? navigationItems[0];
}
