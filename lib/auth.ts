import NextAuth, { getServerSession } from "next-auth";
import { authConfig } from "@/lib/auth/auth-config";

export default NextAuth(authConfig);

export const auth = () => getServerSession(authConfig);

// Type extensions for session
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      roles: string[];
    };
  }

  interface User {
    roles?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    roles: string[];
  }
}
