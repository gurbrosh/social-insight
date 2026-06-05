"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Mail, Lock, Loader2 } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import {
  getOAuthProviders,
  hasOAuthProviders,
  hasMagicLinkProvider,
  isEmailPasswordEnabled,
} from "@/lib/auth/providers";

const emailPasswordSchema = z.object({
  email: z.string().email({ error: "Invalid email address" }),
  password: z.string().min(1, { error: "Password is required" }),
});

const magicLinkSchema = z.object({
  email: z.string().email({ error: "Invalid email address" }),
});

type EmailPasswordData = z.infer<typeof emailPasswordSchema>;
type MagicLinkData = z.infer<typeof magicLinkSchema>;

export function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOAuthLoading, setIsOAuthLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  // Get available providers
  const oauthProviders = getOAuthProviders();
  const showOAuthSection = hasOAuthProviders();
  const showMagicLinkTab = hasMagicLinkProvider();
  const showEmailPasswordForm = isEmailPasswordEnabled();

  // Handle URL error parameters
  useEffect(() => {
    const urlError = searchParams?.get("error");
    if (urlError) {
      switch (urlError) {
        case "OAuthAccountNotLinked":
          setError(
            "This email is already registered. Please sign in with your email and password first, then you can link your OAuth account in settings."
          );
          break;
        case "OAuthSignin":
          setError("Error occurred during OAuth sign-in. Please try again.");
          break;
        case "OAuthCallback":
          setError("Error occurred during authentication callback. Please try again.");
          break;
        case "CredentialsSignin":
          setError("Invalid email or password.");
          break;
        default:
          setError("An authentication error occurred. Please try again.");
      }
    }
  }, [searchParams]);

  const emailPasswordForm = useForm<EmailPasswordData>({
    resolver: zodResolver(emailPasswordSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const magicLinkForm = useForm<MagicLinkData>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: {
      email: "",
    },
  });

  async function onEmailPasswordSubmit(data: EmailPasswordData) {
    try {
      setIsLoading(true);
      setError(null);

      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        throw new Error(
          result.error === "CredentialsSignin" ? "Invalid email or password" : result.error
        );
      }

      if (result?.ok) {
        const callbackUrl = searchParams.get("callbackUrl") || "/";
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  async function onMagicLinkSubmit(data: MagicLinkData) {
    try {
      setIsLoading(true);
      setError(null);

      const result = await signIn("email", {
        email: data.email,
        redirect: false,
      });

      if (result?.error) {
        throw new Error(result.error || "Failed to send magic link");
      }

      setMagicLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  async function onOAuthSignIn(providerId: string) {
    try {
      setIsOAuthLoading(true);
      setError(null);

      // For OAuth, we actually want to redirect to the provider
      // The redirect: false doesn't work properly for OAuth
      const callbackUrl = searchParams.get("callbackUrl") || "/";
      await signIn(providerId, {
        callbackUrl: callbackUrl,
      });

      // Note: This code won't run because signIn redirects to OAuth provider
      // The loading state will be cleared when the component unmounts or
      // when the user returns from OAuth (handled by AuthRedirectHandler)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setIsOAuthLoading(false);
    }
  }

  if (magicLinkSent) {
    return (
      <div className="space-y-4">
        <Alert>
          <Mail className="h-4 w-4" />
          <AlertDescription>
            Check your email! We&apos;ve sent a magic link to sign in.
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="w-full" onClick={() => setMagicLinkSent(false)}>
          Back to Sign In
        </Button>
      </div>
    );
  }

  return (
    <div className="relative space-y-6">
      {/* OAuth Loading Overlay */}
      {isOAuthLoading && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
          <div className="flex flex-col items-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <div className="text-sm text-muted-foreground text-center">
              <p className="font-medium">Redirecting to authentication...</p>
              <p>This may take a few moments</p>
            </div>
          </div>
        </div>
      )}

      {/* OAuth Providers Section */}
      {showOAuthSection && (
        <div className="space-y-4">
          <div className="text-center text-sm text-muted-foreground">Sign in with</div>
          <div className="grid gap-2">
            {oauthProviders.map((provider) => (
              <Button
                key={provider.id}
                variant="outline"
                onClick={() => onOAuthSignIn(provider.id)}
                disabled={isOAuthLoading || isLoading}
                className="w-full"
              >
                {isOAuthLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : provider.id === "google" ? (
                  <Image
                    src="/icons/google-icon.svg"
                    alt="Google"
                    width={16}
                    height={16}
                    className="mr-2"
                  />
                ) : provider.id === "github" ? (
                  <Image
                    src="/icons/github-icon.svg"
                    alt="GitHub"
                    width={16}
                    height={16}
                    className="mr-2"
                  />
                ) : provider.icon ? (
                  <span className="mr-2">{provider.icon}</span>
                ) : null}
                {isOAuthLoading ? "Connecting..." : provider.name}
              </Button>
            ))}
          </div>
          {/* Show separator only if email/password is also enabled */}
          {showEmailPasswordForm && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Email/Password Form */}
      {showEmailPasswordForm && (
        <div className="space-y-4">
          <Form {...emailPasswordForm}>
            <form
              onSubmit={emailPasswordForm.handleSubmit(onEmailPasswordSubmit)}
              className="space-y-4"
            >
              <FormField
                control={emailPasswordForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={emailPasswordForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <PasswordInput placeholder="Enter your password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                <Lock className="mr-2 h-4 w-4" />
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>

              <div className="text-center">
                <Link
                  href="/auth/forgot-password"
                  className="text-sm text-muted-foreground hover:text-primary hover:underline"
                >
                  Forgot your password?
                </Link>
              </div>
            </form>
          </Form>
        </div>
      )}

      {/* Magic Link Section */}
      {showMagicLinkTab && (
        <div className="space-y-4">
          {/* Show separator only if there are other auth methods above */}
          {(showEmailPasswordForm || showOAuthSection) && (
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or use magic link</span>
              </div>
            </div>
          )}
          <Form {...magicLinkForm}>
            <form onSubmit={magicLinkForm.handleSubmit(onMagicLinkSubmit)} className="space-y-4">
              <FormField
                control={magicLinkForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email for Magic Link</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" variant="outline" disabled={isLoading}>
                <Mail className="mr-2 h-4 w-4" />
                {isLoading ? "Sending..." : "Send Magic Link"}
              </Button>
            </form>
          </Form>
        </div>
      )}
    </div>
  );
}
