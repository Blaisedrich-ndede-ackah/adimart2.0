import { Outlet } from 'react-router-dom';
import Navbar from '@/components/Navbar';
import ChatBot from '@/components/ChatBot';

export default function ShopLayout() {
  return (
    <div className="min-h-screen bg-white pb-16 md:pb-0">
      <Navbar />
      <main>
        <Outlet />
      </main>
      <ChatBot />
    </div>
  );
}
