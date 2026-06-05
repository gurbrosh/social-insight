import NextAuth from "@/lib/auth";

export const dynamic = "force-dynamic";

const handler = NextAuth;
export { handler as GET, handler as POST };
