import { ChatRoom } from '@/components/ChatRoom';

interface ChatRoomPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ChatRoomPage({ params }: ChatRoomPageProps) {
  const { id } = await params;
  return <ChatRoom key={id} chatId={id} />;
}
