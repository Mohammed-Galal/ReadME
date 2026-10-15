import type { Metadata } from 'next';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './globals.css';
import DatabaseNotice from '@/components/DatabaseNotice';
import AddLessonsProvider from '@/components/AddLessonsProvider';

export const metadata: Metadata = {
  title: 'ReadME — Read your Markdown aloud',
  description:
    'A privacy-first reader that reads your Markdown files aloud with text-to-speech, right in your browser. Files never leave your device.',
  applicationName: 'ReadME',
};

// Sets Bootstrap's dark theme from the system preference (no Bootstrap JS —
// react-bootstrap components read the same CSS variables).
const themeScript = `(function(){try{var m=window.matchMedia('(prefers-color-scheme: dark)');var a=function(){var d=m.matches;document.documentElement.setAttribute('data-bs-theme',d?'dark':'light');document.documentElement.style.colorScheme=d?'dark':'light';};a();if(m.addEventListener){m.addEventListener('change',a);}else{m.addListener(a);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body><DatabaseNotice /><AddLessonsProvider>{children}</AddLessonsProvider></body>
    </html>
  );
}
