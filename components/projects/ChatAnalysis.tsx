"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Send, Loader2, Sparkles, User, Bot } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { isFullSourceFilterSelection } from "@/lib/utils/platform";
import { formatDateRangeLabel } from "@/lib/utils/date-formatter";

interface ChatAnalysisProps {
  projectId: string;
  dateRange?: string;
  sourceFilter?: string[];
  languageFilter?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function ChatAnalysis({
  projectId,
  dateRange,
  sourceFilter,
  languageFilter,
}: ChatAnalysisProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          question: userMessage.content,
          conversationHistory: messages,
          filters: {
            dateRange: dateRange || "all",
            sources: sourceFilter || [],
            language: languageFilter || "all",
          },
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data = await response.json();

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error sending message:", error);
      toast({
        title: "Error",
        description: "Failed to get AI response. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Ask AI About Your Data
          </CardTitle>
          <CardDescription>
            Ask questions and get AI-powered insights from your collected data
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Chat Messages */}
          <div className="space-y-4 mb-4 max-h-[500px] overflow-y-auto p-4 border rounded-lg bg-muted/30">
            {messages.length === 0 ? (
              <div className="text-center py-12 space-y-4">
                <Sparkles className="h-12 w-12 text-muted-foreground mx-auto" />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">Start a Conversation</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Ask me anything about your social media data. I&apos;ll analyze your posts,
                    influencers, conversations, news, and themes to give you insights.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  <Badge variant="outline">
                    Example: &quot;What are the main topics discussed?&quot;
                  </Badge>
                  <Badge variant="outline">Example: &quot;Who are the top influencers?&quot;</Badge>
                  <Badge variant="outline">
                    Example: &quot;What&apos;s the overall sentiment?&quot;
                  </Badge>
                </div>
              </div>
            ) : (
              <>
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`flex gap-3 max-w-[80%] ${
                        message.role === "user" ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      <div
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                          message.role === "user" ? "bg-primary" : "bg-purple-600"
                        }`}
                      >
                        {message.role === "user" ? (
                          <User className="h-4 w-4 text-primary-foreground" />
                        ) : (
                          <Bot className="h-4 w-4 text-white" />
                        )}
                      </div>
                      <div
                        className={`rounded-lg p-4 ${
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-card border"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                        <p className="text-xs mt-2 opacity-70">
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex gap-3 justify-start">
                    <div className="flex gap-3 max-w-[80%]">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-white" />
                      </div>
                      <div className="rounded-lg p-4 bg-card border">
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-sm text-muted-foreground">Thinking...</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input Area */}
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Ask a question about your data... (Press Enter to send, Shift+Enter for new line)"
              className="min-h-[60px] resize-none"
              disabled={loading}
            />
            <Button onClick={sendMessage} disabled={loading || !input.trim()} size="lg">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Active Filters Info */}
          {(dateRange !== "all" ||
            (sourceFilter && !isFullSourceFilterSelection(sourceFilter)) ||
            languageFilter !== "all") && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-2">Active filters:</p>
              <div className="flex flex-wrap gap-2">
                {dateRange && dateRange !== "all" && (
                  <Badge variant="secondary" className="text-xs">
                    📅 {formatDateRangeLabel(dateRange)}
                  </Badge>
                )}
                {languageFilter && languageFilter !== "all" && (
                  <Badge variant="secondary" className="text-xs">
                    🌍 {languageFilter === "en" ? "English" : languageFilter}
                  </Badge>
                )}
                {sourceFilter && !isFullSourceFilterSelection(sourceFilter) && (
                  <Badge variant="secondary" className="text-xs">
                    📱 {sourceFilter.join(", ")}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
