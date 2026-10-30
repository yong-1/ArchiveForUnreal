import type { NextAuthOptions } from 'next-auth';
import CredentialsModule from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { compare } from 'bcrypt-ts';
import { db } from './archive/db';
const attempts=new Map<string,{count:number;until:number}>();
const Credentials=typeof CredentialsModule==='function'?CredentialsModule:(CredentialsModule as unknown as {default:typeof CredentialsModule}).default;
export const authOptions:NextAuthOptions={
  adapter:PrismaAdapter(db), session:{strategy:'jwt',maxAge:8*60*60},
  pages:{signIn:'/auth'},secret:process.env.NEXTAUTH_SECRET,
  providers:[Credentials({
    name:'팀 계정',credentials:{email:{label:'이메일',type:'email'},password:{label:'비밀번호',type:'password'}},
    async authorize(credentials){
      if(!credentials?.email||!credentials?.password)return null;
      const email=credentials.email.trim().toLowerCase();
      const now=Date.now(),entry=attempts.get(email);
      if(entry&&entry.until>now&&entry.count>=10)return null;
      if(attempts.size>3000)for(const[key,v]of attempts)if(v.until<now)attempts.delete(key);
      attempts.set(email,{count:entry&&entry.until>now?entry.count+1:1,until:now+600_000});
      const user=await db.user.findUnique({where:{email}});
      if(!user?.hashedPassword||!await compare(credentials.password,user.hashedPassword))return null;
      attempts.delete(email);
      return {id:user.id,email:user.email,name:user.name,image:user.image};
    }
  })],
};
