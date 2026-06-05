"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Props = {
  recipients: string[];
  onRecipientsChange: (next: string[]) => void;
  isPendingSave: boolean;
  isPendingSend: boolean;
  onSave: (e: React.FormEvent) => void;
  onSend: (e: React.MouseEvent) => void;
};

export function EmailReportSettingsTab({
  recipients,
  onRecipientsChange,
  isPendingSave,
  isPendingSend,
  onSave,
  onSend,
}: Props) {
  function addRecipient() {
    onRecipientsChange([...recipients, ""]);
  }

  function updateRecipient(index: number, value: string) {
    const next = [...recipients];
    next[index] = value;
    onRecipientsChange(next);
  }

  function removeRecipient(index: number) {
    if (recipients.length <= 1) return;
    onRecipientsChange(recipients.filter((_, i) => i !== index));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send email report</CardTitle>
        <CardDescription>
          Recipients and actions for the scheduled-style report email. Date range and project are set
          in the bar above and apply to all tabs on this page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="space-y-6 max-w-lg">
          <div className="space-y-2">
            <Label>Email recipients</Label>
            <div className="space-y-2">
              {recipients.map((email, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => updateRecipient(index, e.target.value)}
                    className="flex-1"
                  />
                  {recipients.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRecipient(index)}
                      aria-label="Remove recipient"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addRecipient} className="gap-1">
              <Plus className="h-4 w-4" />
              Add recipient
            </Button>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={isPendingSave || isPendingSend}>
              {isPendingSave ? "Saving…" : "Save configuration"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPendingSave || isPendingSend}
              onClick={onSend}
            >
              {isPendingSend ? "Sending…" : "Send report now"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
