"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

export function AuthRedirectHandler() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [adminCheckComplete, setAdminCheckComplete] = useState(false);

  useEffect(() => {
    // Only redirect if user is authenticated and no specific callback URL
    if (status === "authenticated" && session?.user && !adminCheckComplete) {
      const callbackUrl = searchParams?.get("callbackUrl");

      console.log("AuthRedirectHandler: User is authenticated", {
        email: session.user.email,
        callbackUrl,
      });

      // If no specific callback URL or callback is signin page, check admin status
      if (!callbackUrl || callbackUrl.includes("/auth/signin")) {
        // Check if admin exists to prevent redirect loops
        fetch("/api/admin/check")
          .then((res) => res.json())
          .then((data) => {
            console.log("AuthRedirectHandler: Admin check result", data);

            if (data.adminExists) {
              console.log("AuthRedirectHandler: Admin exists, redirecting to home");
              router.replace("/");
            } else {
              console.log("AuthRedirectHandler: No admin exists, redirecting to setup");
              router.replace("/auth/setup-admin");
            }
          })
          .catch((error) => {
            console.error("AuthRedirectHandler: Error checking admin status", error);
            // Fallback to home on error
            router.replace("/");
          })
          .finally(() => {
            setAdminCheckComplete(true);
          });
      } else {
        console.log("AuthRedirectHandler: Redirecting to callback URL", callbackUrl);
        router.replace(callbackUrl);
        setAdminCheckComplete(true);
      }
    }
  }, [status, session, router, searchParams, adminCheckComplete]);

  // Don't render anything visible
  return null;
}
