import {
  buildCampaignPhase1CsvContent,
  exclusionIdsToLabels,
} from "./build-campaign-phase1-csv";
import type { CampaignCandidatePreviewRow, CampaignExclusionCriterionId } from "./types";

export function downloadCampaignPhase1CsvClient(
  rows: CampaignCandidatePreviewRow[],
  filenamePrefix: string,
  selectedExclusionIds?: readonly CampaignExclusionCriterionId[]
): void {
  const labels = selectedExclusionIds?.length
    ? exclusionIdsToLabels(selectedExclusionIds)
    : undefined;
  const content = buildCampaignPhase1CsvContent(rows, { exclusionLabels: labels });
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** @deprecated Use downloadCampaignPhase1CsvClient */
export function downloadCampaignSourceCsvClient(
  rows: CampaignCandidatePreviewRow[],
  filenamePrefix: string
): void {
  downloadCampaignPhase1CsvClient(rows, filenamePrefix);
}
