import type { Metadata } from 'next';
import './globals.css';
import './archive.css';
import NextAuthProvider from '@/components/NextAuthProvider';
export const metadata:Metadata={title:'NextFlix Archive · 제작의 기록',description:'제작 결과물과 연결된 제작 원본을 보존하고 다시 활용하는 팀 아카이브'};
export default function RootLayout({children}:{children:React.ReactNode}){
 return <html lang="ko"><body><NextAuthProvider>{children}</NextAuthProvider></body></html>;
}
