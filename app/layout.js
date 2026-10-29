import './globals.css';

export const metadata = {
  title: 'NovoDS Studio: DS200 Fleet Console',
  description: 'Digital signage media, playlist, and schedule management for NovoDS DS200 devices.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
