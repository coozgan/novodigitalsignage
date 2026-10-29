import './globals.css';

export const metadata = {
  title: 'NovoDS Studio: DS200 Fleet Console',
  icons: {icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="6" fill="%233b82f6"/%3E%3Cpath d="M8 24V8l16 16V8" fill="none" stroke="white" stroke-width="3"/%3E%3C/svg%3E'},
  description: 'Digital signage media, playlist, and schedule management for NovoDS DS200 devices.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
