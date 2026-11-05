import { BuddyPublicProfile } from '@/components/BuddyPublicProfile';

interface BuddyProfilePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function BuddyProfilePage({ params }: BuddyProfilePageProps) {
  const { id } = await params;
  return <BuddyPublicProfile key={id} userId={id} />;
}
