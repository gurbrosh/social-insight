"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { UserPlus } from "lucide-react";
import { getOAuthProviders, hasOAuthProviders } from "@/lib/auth/providers";

const signUpSchema = z
  .object({
    email: z.string().email({ error: "Invalid email address" }),
    password: z.string().min(8, { error: "Password must be at least 8 characters" }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: "Passwords don't match",
    path: ["confirmPassword"],
  });

type SignUpData = z.infer<typeof signUpSchema>;

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  // Get available OAuth providers
  const oauthProviders = getOAuthProviders();
  const showOAuthSection = hasOAuthProviders();

  const form = useForm<SignUpData>({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: SignUpData) {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to sign up");
      }

      // Automatically sign in the user after successful registration
      const signInResult = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (signInResult?.ok) {
        router.push("/");
        router.refresh();
      } else {
        // If auto sign-in fails, show verification message
        setVerificationSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  async function onOAuthSignIn(providerId: string) {
    try {
      setIsLoading(true);
      setError(null);

      const result = await signIn(providerId, {
        redirect: false,
      });

      if (result?.error) {
        throw new Error(result.error || `Failed to sign up with ${providerId}`);
      }

      if (result?.ok) {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  if (verificationSent) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertDescription>
            We&apos;ve sent a verification email to {form.getValues("email")}. Please check your
            inbox and click the verification link to complete your registration.
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="w-full" onClick={() => router.push("/auth/signin")}>
          Go to Sign In
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* OAuth Providers Section */}
      {showOAuthSection && (
        <div className="space-y-4">
          <div className="text-center text-sm text-muted-foreground">Sign up with</div>
          <div className="grid gap-2">
            {oauthProviders.map((provider) => (
              <Button
                key={provider.id}
                variant="outline"
                onClick={() => onOAuthSignIn(provider.id)}
                disabled={isLoading}
                className="w-full"
              >
                {provider.icon && <span className="mr-2">{provider.icon}</span>}
                {provider.name}
              </Button>
            ))}
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or create account</span>
            </div>
          </div>
        </div>
      )}

      {/* Email/Password Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
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
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <PasswordInput placeholder="Create a secure password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm Password</FormLabel>
                <FormControl>
                  <PasswordInput placeholder="Confirm your password" {...field} />
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
            <UserPlus className="mr-2 h-4 w-4" />
            {isLoading ? "Creating account..." : "Create Account"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
