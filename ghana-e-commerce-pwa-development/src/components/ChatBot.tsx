import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Bot, User, Loader2 } from 'lucide-react';
import type { ChatMessage } from '@/lib/types';
import { useAdimartStore } from '@/lib/AdimartProvider';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

function systemPrompt(brand: string): string {
  return `You are a friendly and helpful shopping assistant for ${brand}, an online store based in Ghana and powered by Adimat. You help customers with:
- Product recommendations
- Delivery information (we deliver across Ghana, typically 1-3 business days in Takoradi, 3-7 days outside Takoradi)
- Payment options (we accept Paystack/mobile money and Cash on Delivery)
- All prices are in Ghana Cedis (₵ / GHS)
- General shopping questions

Be concise, friendly, and helpful. If you don't know specific product details, suggest the customer browse the shop or contact support.`;
}

export default function ChatBot() {
  const { store } = useAdimartStore();
  const brand = store?.name || 'BONDZTECH';
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: `Hi there! Welcome to ${brand}. I can help with product recommendations, delivery info, or payment questions.`,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const toggleChat = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    window.addEventListener('toggle-chat', toggleChat);
    return () => window.removeEventListener('toggle-chat', toggleChat);
  }, [toggleChat]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      let reply = '';

      if (GEMINI_API_KEY) {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt(brand) }] },
              contents: [
                ...messages.map((m) => ({
                  role: m.role === 'assistant' ? 'model' : 'user',
                  parts: [{ text: m.content }],
                })),
                { role: 'user', parts: [{ text: input.trim() }] },
              ],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 500,
              },
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
      }

      if (!reply) {
        reply = getLocalReply(input.trim(), brand);
      }

      const botMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: reply,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again or browse our shop directly.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Chat Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-20 md:bottom-6 right-4 z-50 inline-flex items-center gap-2 bg-gradient-to-r from-orange-500 to-yellow-400 text-white p-4 md:px-5 rounded-full shadow-2xl hover:shadow-orange-300/50 hover:scale-105 transition-all duration-300"
          aria-label={`Open ${brand} shopping assistant`}
        >
          <MessageCircle className="w-6 h-6" />
          <span className="hidden text-sm font-semibold md:inline">Need help?</span>
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-20 md:bottom-6 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm bg-white rounded-2xl shadow-2xl border border-orange-100 flex flex-col overflow-hidden"
          style={{ height: 'min(500px, calc(100vh - 10rem))' }}
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-orange-500 to-yellow-400 text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">{brand} Assistant</h3>
                <p className="text-xs text-white/80">Always here to help</p>
              </div>
            </div>
            <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-white/20 rounded-full transition-colors" aria-label="Close shopping assistant">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-orange-50/30">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 bg-orange-100 rounded-full flex items-center justify-center shrink-0 mt-1">
                    <Bot className="w-4 h-4 text-orange-600" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-orange-500 text-white rounded-br-sm'
                      : 'bg-white text-gray-700 rounded-bl-sm shadow-sm border border-gray-100'
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 bg-orange-500 rounded-full flex items-center justify-center shrink-0 mt-1">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-2 justify-start">
                <div className="w-7 h-7 bg-orange-100 rounded-full flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-orange-600" />
                </div>
                <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm border border-gray-100">
                  <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 bg-white border-t border-gray-100 shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Ask me anything..."
                className="flex-1 px-4 py-2.5 bg-gray-50 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 border border-gray-200"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white p-2.5 rounded-full transition-colors"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function getLocalReply(input: string, brand: string): string {
  const lower = input.toLowerCase();

  if (lower.includes('deliver') || lower.includes('shipping')) {
    return "We deliver across Ghana. Delivery within Takoradi takes 1-3 business days, and outside Takoradi takes 3-7 business days. Delivery fees are calculated at checkout.";
  }
  if (lower.includes('pay') || lower.includes('mobile money') || lower.includes('momo')) {
    return "We accept Paystack for Mobile Money, Visa, and Mastercard, plus Cash on Delivery. You can choose your preferred payment method at checkout.";
  }
  if (lower.includes('return') || lower.includes('refund')) {
    return "We offer returns within 7 days of delivery. Items must be in their original condition. Please contact our support team to initiate a return.";
  }
  if (lower.includes('price') || lower.includes('cost') || lower.includes('how much')) {
    return "All our prices are in Ghana Cedis (₵). You can browse our shop to see current prices and featured deals.";
  }
  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return `Hello! Welcome to ${brand}. Feel free to ask about products, delivery, or payments.`;
  }
  if (lower.includes('thank')) {
    return "You're welcome. Happy shopping, and feel free to ask if you need anything else.";
  }

  return "Thanks for your question. I recommend browsing our shop for the latest products and deals. You can also filter by category to find exactly what you need.";
}
