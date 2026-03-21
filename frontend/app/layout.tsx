import './globals.css';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';

export const metadata = {
  title: 'NeuralEDGE — PULSE Command Center',
  description: 'Chief of Staff Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <div className="min-h-screen flex flex-col" style={{ background: '#0d0d14' }}>
          <Header />
          <div className="flex flex-1">
            <Sidebar />
            <main className="flex-1 p-8 overflow-auto max-w-[1400px]">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
