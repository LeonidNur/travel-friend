import { ChatParticipantProfile } from '@/components/ChatParticipantProfile';

interface ChatParticipantProfilePageProps {
  params: Promise<{ id: string; userId: string }>;
}

export default async function ChatParticipantProfilePage({ params }: ChatParticipantProfilePageProps) {
  const { id, userId } = await params;
  return <ChatParticipantProfile chatId={id} userId={userId} />;
}
